import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import deepEqual from "fast-deep-equal"

import type { HistoryItem } from "@bear-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { getStorageBasePath } from "../../utils/storage"

/**
 * Index file format for fast startup reads.
 */
interface HistoryIndex {
	version: number
	updatedAt: number
	entries: HistoryItem[]
}

/**
 * TaskHistoryStore encapsulates all task history persistence logic.
 *
 * Each task's HistoryItem is stored as an individual JSON file in its
 * existing task directory (`globalStorage/tasks/<taskId>/history_item.json`).
 * A single index file (`globalStorage/tasks/_index.json`) is maintained
 * as a cache for fast list reads at startup.
 *
 * Cross-process safety comes from `safeWriteJson`'s `proper-lockfile`
 * on per-task file writes. Within a single extension host process,
 * an in-process write lock serializes mutations.
 */
/**
 * Options for TaskHistoryStore constructor.
 */
export interface TaskHistoryStoreOptions {
	/**
	 * Optional callback invoked inside the write lock after each mutation
	 * (upsert, delete, deleteMany). Used for serialized write-through to
	 * globalState during the transition period.
	 */
	onWrite?: (items: HistoryItem[]) => Promise<void>
}

export class TaskHistoryStore {
	private readonly globalStoragePath: string
	private readonly onWrite?: (items: HistoryItem[]) => Promise<void>
	private cache: Map<string, HistoryItem> = new Map()
	/**
	 * mtime and size of each per-task file as last read by reconcile(), to skip
	 * unchanged files. Size is part of the stamp because a rewrite within the
	 * mtime resolution of coarse file systems (HFS+, FAT, network shares) keeps
	 * the mtime but usually changes the size.
	 */
	private taskFileStamps: Map<string, string> = new Map()
	/** updatedAt of the index loaded at initialize(), if any. */
	private loadedIndexUpdatedAt: number | undefined
	private writeLock: Promise<void> = Promise.resolve()
	private indexWriteTimer: ReturnType<typeof setTimeout> | null = null
	private fsWatcher: fsSync.FSWatcher | null = null
	private reconcileTimer: ReturnType<typeof setTimeout> | null = null
	private disposed = false

	/**
	 * Promise that resolves when initialization is complete.
	 * Callers can await this to ensure the store is ready before reading.
	 */
	public readonly initialized: Promise<void>
	private resolveInitialized!: () => void

	/** Debounce window for index writes in milliseconds. */
	private static readonly INDEX_WRITE_DEBOUNCE_MS = 2000

	/** Periodic reconciliation interval in milliseconds. */
	private static readonly RECONCILE_INTERVAL_MS = 5 * 60 * 1000

	constructor(globalStoragePath: string, options?: TaskHistoryStoreOptions) {
		this.globalStoragePath = globalStoragePath
		this.onWrite = options?.onWrite
		this.initialized = new Promise<void>((resolve) => {
			this.resolveInitialized = resolve
		})
	}

	// ────────────────────────────── Lifecycle ──────────────────────────────

	/**
	 * Load index, reconcile if needed, start watchers.
	 */
	async initialize(): Promise<void> {
		try {
			const tasksDir = await this.getTasksDir()
			await fs.mkdir(tasksDir, { recursive: true })

			// 1. Load existing index into the cache
			await this.loadIndex()

			// 2. Reconcile cache against actual task directories on disk. The per-task
			//    files are the source of truth and the index is written with a debounce,
			//    so after a crash or kill the index can hold an older version of a task
			//    (for example without its delegation fields). Re-read every file written
			//    since the index was, or every file when there is no usable index.
			await this.reconcile(
				this.loadedIndexUpdatedAt !== undefined
					? { changedSince: this.loadedIndexUpdatedAt }
					: { forceRefresh: true },
			)

			// 3. Start fs.watch for cross-instance reactivity
			this.startWatcher()

			// 4. Start periodic reconciliation as a defensive fallback
			this.startPeriodicReconciliation()
		} finally {
			// Mark initialization as complete so callers awaiting `initialized` can proceed
			this.resolveInitialized()
		}
	}

	/**
	 * Flush pending writes, clear watchers, release resources.
	 */
	dispose(): void {
		this.disposed = true

		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
			this.indexWriteTimer = null
		}

		if (this.reconcileTimer) {
			clearTimeout(this.reconcileTimer)
			this.reconcileTimer = null
		}

		if (this.fsWatcher) {
			this.fsWatcher.close()
			this.fsWatcher = null
		}

		// Synchronously flush the index (best-effort)
		this.flushIndex().catch((err) => {
			console.error("[TaskHistoryStore] Error flushing index on dispose:", err)
		})
	}

	// ────────────────────────────── Reads ──────────────────────────────

	/**
	 * Get a single history item by task ID.
	 */
	get(taskId: string): HistoryItem | undefined {
		return this.cache.get(taskId)
	}

	/**
	 * Get all history items, sorted by timestamp descending (newest first).
	 */
	getAll(): HistoryItem[] {
		return Array.from(this.cache.values()).sort((a, b) => b.ts - a.ts)
	}

	/**
	 * Get history items filtered by workspace path.
	 */
	getByWorkspace(workspace: string): HistoryItem[] {
		return this.getAll().filter((item) => item.workspace === workspace)
	}

	// ────────────────────────────── Mutations ──────────────────────────────

	/**
	 * Insert or update a history item.
	 *
	 * Writes the per-task file immediately (source of truth),
	 * updates the in-memory Map, and schedules a debounced index write.
	 */
	async upsert(item: HistoryItem): Promise<HistoryItem[]> {
		return this.withLock(() => this.upsertUnlocked(item))
	}

	/**
	 * Upsert body executed without acquiring the lock.
	 * Must only be called from within a `withLock` callback.
	 */
	private async upsertUnlocked(item: HistoryItem): Promise<HistoryItem[]> {
		const existing = this.cache.get(item.id)

		// Merge: preserve existing metadata unless explicitly overwritten
		const merged = existing ? { ...existing, ...item } : item

		// Write per-task file (source of truth)
		await this.writeTaskFile(merged)

		// Update in-memory cache
		this.cache.set(merged.id, merged)

		// Schedule debounced index write
		this.scheduleIndexWrite()

		const all = this.getAll()

		// Call onWrite callback inside the lock for serialized write-through
		if (this.onWrite) {
			await this.onWrite(all)
		}

		return all
	}

	/**
	 * Read a HistoryItem from the in-memory cache and write back an updated version,
	 * all within a single lock acquisition so no concurrent writer can interleave
	 * between the read and the write.
	 *
	 * The `updater` receives a deep copy of the current cached item and must return
	 * the new item synchronously. It must not perform I/O or acquire any other lock.
	 *
	 * @throws If the task ID is not present in the cache, or the updater changes the id.
	 */
	public atomicReadAndUpdate(taskId: string, updater: (current: HistoryItem) => HistoryItem): Promise<HistoryItem[]> {
		return this.withLock(async () => {
			const current = this.cache.get(taskId)

			if (!current) {
				throw new Error(`[TaskHistoryStore] atomicReadAndUpdate: task ${taskId} not found in cache`)
			}

			// Deep-copy so a mutating updater cannot alter cached state before persistence.
			const updated = updater(structuredClone(current))

			if (updated.id !== taskId) {
				throw new Error(
					`[TaskHistoryStore] atomicReadAndUpdate: updater changed task id from ${taskId} to ${updated.id}`,
				)
			}

			return this.upsertUnlocked(updated)
		})
	}

	/**
	 * Atomically update two related HistoryItems (e.g. a delegated child and its
	 * parent) within a single lock acquisition. Both updaters receive deep copies,
	 * must be synchronous and must not perform I/O or acquire any other lock.
	 *
	 * Both per-task files are written before the in-memory cache is touched, so
	 * readers never observe a half-updated cache. If the second file write fails
	 * the first file has already landed on disk (no rollback), but the cache is
	 * left unchanged and the error is surfaced to the caller.
	 *
	 * @throws If either task ID is not present in the cache, or an updater changes the id.
	 */
	public atomicUpdatePair(
		firstId: string,
		secondId: string,
		firstUpdater: (current: HistoryItem) => HistoryItem,
		secondUpdater: (current: HistoryItem) => HistoryItem,
	): Promise<HistoryItem[]> {
		return this.withLock(async () => {
			const first = this.cache.get(firstId)

			if (!first) {
				throw new Error(`[TaskHistoryStore] atomicUpdatePair: ${firstId} not found in cache`)
			}

			const second = this.cache.get(secondId)

			if (!second) {
				throw new Error(`[TaskHistoryStore] atomicUpdatePair: ${secondId} not found in cache`)
			}

			const updatedFirst = firstUpdater(structuredClone(first))
			const updatedSecond = secondUpdater(structuredClone(second))

			if (updatedFirst.id !== firstId) {
				throw new Error(
					`[TaskHistoryStore] atomicUpdatePair: first updater changed id from ${firstId} to ${updatedFirst.id}`,
				)
			}

			if (updatedSecond.id !== secondId) {
				throw new Error(
					`[TaskHistoryStore] atomicUpdatePair: second updater changed id from ${secondId} to ${updatedSecond.id}`,
				)
			}

			// Merge with existing cache entries, mirroring upsert().
			const mergedFirst = { ...first, ...updatedFirst }
			const mergedSecond = { ...second, ...updatedSecond }

			await this.writeTaskFile(mergedFirst)
			await this.writeTaskFile(mergedSecond)

			// Both disk writes succeeded — now update the cache.
			this.cache.set(firstId, mergedFirst)
			this.cache.set(secondId, mergedSecond)

			this.scheduleIndexWrite()

			const all = this.getAll()

			if (this.onWrite) {
				await this.onWrite(all)
			}

			return all
		})
	}

	/**
	 * Delete a single task's history item.
	 */
	async delete(taskId: string): Promise<void> {
		return this.withLock(async () => {
			this.cache.delete(taskId)
			this.taskFileStamps.delete(taskId)

			// Remove per-task file (best-effort)
			try {
				const filePath = await this.getTaskFilePath(taskId)
				await fs.unlink(filePath)
			} catch {
				// File may already be deleted
			}

			this.scheduleIndexWrite()

			// Call onWrite callback inside the lock for serialized write-through
			if (this.onWrite) {
				await this.onWrite(this.getAll())
			}
		})
	}

	/**
	 * Delete multiple tasks' history items in a batch.
	 */
	async deleteMany(taskIds: string[]): Promise<void> {
		return this.withLock(async () => {
			for (const taskId of taskIds) {
				this.cache.delete(taskId)
				this.taskFileStamps.delete(taskId)

				try {
					const filePath = await this.getTaskFilePath(taskId)
					await fs.unlink(filePath)
				} catch {
					// File may already be deleted
				}
			}

			this.scheduleIndexWrite()

			// Call onWrite callback inside the lock for serialized write-through
			if (this.onWrite) {
				await this.onWrite(this.getAll())
			}
		})
	}

	// ────────────────────────────── Reconciliation ──────────────────────────────

	/**
	 * Scan task directories vs index and fix any drift.
	 *
	 * - Tasks on disk whose file is new or changed since the last scan: (re)read
	 * - Tasks in cache but missing from disk: remove
	 *
	 * Without `forceRefresh`, a task whose file mtime and size match the last scan
	 * is skipped, so watcher and periodic passes stay cheap. A changed file (for
	 * example written by another window) replaces the cached entry. With
	 * `changedSince`, a cached task whose file is older than that time is not
	 * re-read either (used at startup against the index's own write time).
	 */
	async reconcile(options: { forceRefresh?: boolean; changedSince?: number } = {}): Promise<void> {
		// Run through the write lock to prevent interleaving with upsert/delete
		return this.withLock(async () => {
			const tasksDir = await this.getTasksDir()

			let dirEntries: string[]
			try {
				dirEntries = await fs.readdir(tasksDir)
			} catch {
				return // tasks dir doesn't exist yet
			}

			// Filter out the index file and hidden files
			const taskDirNames = dirEntries.filter((name) => !name.startsWith("_") && !name.startsWith("."))

			const onDiskIds = new Set(taskDirNames)
			const cacheIds = new Set(this.cache.keys())
			let changed = false

			for (const taskId of onDiskIds) {
				try {
					const taskFilePath = path.join(tasksDir, taskId, GlobalFileNames.historyItem)
					const { mtimeMs, size } = await fs.stat(taskFilePath)
					const stamp = `${mtimeMs}:${size}`

					if (!options.forceRefresh && this.cache.has(taskId)) {
						if (this.taskFileStamps.get(taskId) === stamp) {
							continue
						}

						if (options.changedSince !== undefined && mtimeMs < options.changedSince) {
							this.taskFileStamps.set(taskId, stamp)
							continue
						}
					}

					const item = await this.readTaskFile(taskId, taskFilePath)

					if (item) {
						this.taskFileStamps.set(taskId, stamp)

						if (!deepEqual(this.cache.get(taskId), item)) {
							this.cache.set(taskId, item)
							changed = true
						}
					}
				} catch {
					// No history_item.json yet, or a corrupted file: keep what the cache has.
				}
			}

			// Tasks in cache but not on disk: remove from cache
			for (const taskId of cacheIds) {
				if (!onDiskIds.has(taskId)) {
					this.cache.delete(taskId)
					this.taskFileStamps.delete(taskId)
					changed = true
				}
			}

			if (changed) {
				this.scheduleIndexWrite()
			}
		})
	}

	// ────────────────────────────── Cache invalidation ──────────────────────────────

	/**
	 * Invalidate a single task's cache entry (re-read from disk on next access).
	 */
	async invalidate(taskId: string): Promise<void> {
		this.taskFileStamps.delete(taskId)

		try {
			const item = await this.readTaskFile(taskId)
			if (item) {
				this.cache.set(taskId, item)
			} else {
				this.cache.delete(taskId)
			}
		} catch {
			this.cache.delete(taskId)
		}
	}

	/**
	 * Re-read one task's entry from its file under the write lock, so a change
	 * made by another window is seen before acting on it. Returns the fresh entry.
	 */
	async refresh(taskId: string): Promise<HistoryItem | undefined> {
		return this.withLock(async () => {
			await this.invalidate(taskId)
			return this.cache.get(taskId)
		})
	}

	/**
	 * Clear all in-memory cache and reload from index.
	 */
	invalidateAll(): void {
		this.cache.clear()
		this.taskFileStamps.clear()
	}

	// ────────────────────────────── Migration ──────────────────────────────

	/**
	 * Migrate from globalState taskHistory array to per-task files.
	 *
	 * For each entry in the globalState array, writes a `history_item.json`
	 * file if one doesn't already exist. This is idempotent and safe to re-run.
	 */
	async migrateFromGlobalState(taskHistoryEntries: HistoryItem[]): Promise<void> {
		if (!taskHistoryEntries || taskHistoryEntries.length === 0) {
			return
		}

		// Under the write lock: the cache and index updates must not interleave with a
		// concurrent upsert, or the index written here could drop that upsert.
		await this.withLock(async () => {
			const tasksDir = await this.getTasksDir()

			for (const item of taskHistoryEntries) {
				if (!item.id) {
					continue
				}

				// Check if task directory exists on disk
				const taskDir = path.join(tasksDir, item.id)

				try {
					await fs.access(taskDir)
				} catch {
					// Task directory doesn't exist; skip this entry as it's orphaned in globalState
					continue
				}

				// Write history_item.json if it doesn't exist yet
				const filePath = path.join(taskDir, GlobalFileNames.historyItem)
				try {
					await fs.access(filePath)
					// File already exists, skip (don't overwrite existing per-task files)
				} catch {
					// File doesn't exist, write it
					await safeWriteJson(filePath, item)
					this.cache.set(item.id, item)
				}
			}

			// Write the index
			await this.writeIndex()
		})
	}

	// ────────────────────────────── Private: Index management ──────────────────────────────

	/**
	 * Load the `_index.json` file into the in-memory cache.
	 */
	private async loadIndex(): Promise<void> {
		const indexPath = await this.getIndexPath()

		try {
			const raw = await fs.readFile(indexPath, "utf8")
			const index: HistoryIndex = JSON.parse(raw)

			if (index.version === 1 && Array.isArray(index.entries)) {
				this.loadedIndexUpdatedAt = typeof index.updatedAt === "number" ? index.updatedAt : undefined

				for (const entry of index.entries) {
					if (entry.id) {
						this.cache.set(entry.id, entry)
					}
				}
			}
		} catch {
			// Index doesn't exist or is corrupted; cache stays empty.
			// Reconciliation will rebuild it from per-task files.
		}
	}

	/**
	 * Write the full index to disk.
	 */
	private async writeIndex(): Promise<void> {
		const indexPath = await this.getIndexPath()
		const index: HistoryIndex = {
			version: 1,
			updatedAt: Date.now(),
			entries: this.getAll(),
		}

		await safeWriteJson(indexPath, index)
	}

	/**
	 * Schedule a debounced index write.
	 */
	private scheduleIndexWrite(): void {
		if (this.disposed) {
			return
		}

		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
		}

		this.indexWriteTimer = setTimeout(async () => {
			this.indexWriteTimer = null
			try {
				await this.writeIndex()
			} catch (err) {
				console.error("[TaskHistoryStore] Failed to write index:", err)
			}
		}, TaskHistoryStore.INDEX_WRITE_DEBOUNCE_MS)
	}

	/**
	 * Force an immediate index write (called on dispose/shutdown).
	 */
	async flushIndex(): Promise<void> {
		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
			this.indexWriteTimer = null
		}

		await this.writeIndex()
	}

	// ────────────────────────────── Private: Per-task file I/O ──────────────────────────────

	/**
	 * Write a HistoryItem to its per-task `history_item.json` file.
	 */
	private async writeTaskFile(item: HistoryItem): Promise<void> {
		const filePath = await this.getTaskFilePath(item.id)
		await safeWriteJson(filePath, item)
	}

	/**
	 * Read a HistoryItem from its per-task `history_item.json` file.
	 */
	private async readTaskFile(taskId: string, knownFilePath?: string): Promise<HistoryItem | null> {
		const filePath = knownFilePath ?? (await this.getTaskFilePath(taskId))

		try {
			const raw = await fs.readFile(filePath, "utf8")
			const item: HistoryItem = JSON.parse(raw)
			return item.id ? item : null
		} catch {
			return null
		}
	}

	// ────────────────────────────── Private: fs.watch ──────────────────────────────

	/**
	 * Watch the tasks directory for changes from other instances.
	 */
	private startWatcher(): void {
		if (this.disposed) {
			return
		}

		// Use a debounced handler to avoid excessive reconciliation
		let watchDebounce: ReturnType<typeof setTimeout> | null = null

		this.getTasksDir()
			.then((tasksDir) => {
				if (this.disposed) {
					return
				}

				try {
					this.fsWatcher = fsSync.watch(tasksDir, { recursive: false }, (_eventType, _filename) => {
						if (this.disposed) {
							return
						}

						// Debounce the reconciliation triggered by fs.watch
						if (watchDebounce) {
							clearTimeout(watchDebounce)
						}
						watchDebounce = setTimeout(() => {
							this.reconcile().catch((err) => {
								console.error("[TaskHistoryStore] Reconciliation after fs.watch failed:", err)
							})
						}, 500)
					})

					this.fsWatcher.on("error", (err) => {
						console.error("[TaskHistoryStore] fs.watch error:", err)
						// fs.watch is unreliable on some platforms; periodic reconciliation
						// serves as the fallback.
					})
				} catch (err) {
					console.error("[TaskHistoryStore] Failed to start fs.watch:", err)
				}
			})
			.catch((err) => {
				console.error("[TaskHistoryStore] Failed to get tasks dir for watcher:", err)
			})
	}

	/**
	 * Start periodic reconciliation as a defensive fallback for platforms
	 * where fs.watch is unreliable.
	 */
	private startPeriodicReconciliation(): void {
		if (this.disposed) {
			return
		}

		this.reconcileTimer = setTimeout(async () => {
			if (this.disposed) {
				return
			}
			try {
				await this.reconcile()
			} catch (err) {
				console.error("[TaskHistoryStore] Periodic reconciliation failed:", err)
			}
			this.startPeriodicReconciliation()
		}, TaskHistoryStore.RECONCILE_INTERVAL_MS)
	}

	// ────────────────────────────── Private: Write lock ──────────────────────────────

	/**
	 * Serializes all read-modify-write operations within a single extension
	 * host process to prevent concurrent interleaving.
	 */
	private withLock<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.writeLock.then(fn, fn)
		this.writeLock = result.then(
			() => {},
			() => {},
		)
		return result
	}

	// ────────────────────────────── Private: Path helpers ──────────────────────────────

	/**
	 * Get the tasks base directory path, resolving custom storage paths.
	 */
	private async getTasksDir(): Promise<string> {
		const basePath = await getStorageBasePath(this.globalStoragePath)
		return path.join(basePath, "tasks")
	}

	/**
	 * Get the path to a task's `history_item.json` file.
	 */
	private async getTaskFilePath(taskId: string): Promise<string> {
		const tasksDir = await this.getTasksDir()
		return path.join(tasksDir, taskId, GlobalFileNames.historyItem)
	}

	/**
	 * Get the path to the `_index.json` file.
	 */
	private async getIndexPath(): Promise<string> {
		const tasksDir = await this.getTasksDir()
		return path.join(tasksDir, GlobalFileNames.historyIndex)
	}
}
