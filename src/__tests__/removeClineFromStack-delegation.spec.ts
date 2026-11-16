// npx vitest run __tests__/removeClineFromStack-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import { ClineProvider } from "../core/webview/ClineProvider"

const delegatedParent = {
	id: "parent-1",
	task: "Parent task",
	ts: 1000,
	number: 1,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	status: "delegated",
	awaitingChildId: "child-1",
	delegatedToId: "child-1",
	childIds: ["child-1"],
}

describe("ClineProvider.removeClineFromStack() keeps the delegation link", () => {
	function buildMockProvider(opts: { childTaskId: string; parentTaskId?: string }) {
		const childTask = {
			taskId: opts.childTaskId,
			instanceId: "inst-1",
			parentTaskId: opts.parentTaskId,
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
		}

		const provider = {
			clineStack: [childTask] as any[],
			taskEventListeners: new Map(),
			log: vi.fn(),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { ...delegatedParent } }),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
		}

		return { provider, childTask }
	}

	it("leaves a delegated parent waiting when the user navigates away from its child", async () => {
		const { provider, childTask } = buildMockProvider({ childTaskId: "child-1", parentTaskId: "parent-1" })

		await (ClineProvider.prototype as any).removeClineFromStack.call(provider)

		expect(provider.clineStack).toHaveLength(0)
		expect(childTask.abortTask).toHaveBeenCalledWith(true)
		// The child can still hand its result back when it is reopened and finished.
		expect(provider.getTaskWithId).not.toHaveBeenCalled()
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})

	it("does not touch the grandparent while a nested delegation replaces the child", async () => {
		// A delegated to B, B now delegates to C: delegateParentAndOpenChild pops B.
		const { provider } = buildMockProvider({ childTaskId: "task-B", parentTaskId: "task-A" })

		await (ClineProvider.prototype as any).removeClineFromStack.call(provider)

		expect(provider.clineStack).toHaveLength(0)
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})

	it("handles empty stack gracefully", async () => {
		const provider = {
			clineStack: [] as any[],
			taskEventListeners: new Map(),
			log: vi.fn(),
			getTaskWithId: vi.fn(),
			updateTaskHistory: vi.fn(),
		}

		await (ClineProvider.prototype as any).removeClineFromStack.call(provider)

		expect(provider.clineStack).toHaveLength(0)
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})
})

describe("ClineProvider.detachDelegatedParent()", () => {
	function buildProvider(parent: Record<string, any> | undefined) {
		let stored = parent ? { ...parent } : undefined
		const written: Record<string, any>[] = []

		return {
			written,
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore: {
				get: vi.fn(() => (stored ? { ...stored } : undefined)),
				refresh: vi.fn(async () => (stored ? { ...stored } : undefined)),
				atomicReadAndUpdate: vi.fn(async (_id: string, updater: (item: any) => any) => {
					if (!stored) {
						throw new Error("not found in cache")
					}
					stored = updater({ ...stored })
					written.push(stored!)
					return []
				}),
			},
			getTaskWithId: vi.fn().mockRejectedValue(new Error("Task not found")),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
		}
	}

	it("sets a parent awaiting the child back to active", async () => {
		const provider = buildProvider(delegatedParent)

		const result = await (ClineProvider.prototype as any).detachDelegatedParent.call(
			provider,
			"parent-1",
			"child-1",
		)

		expect(result).toEqual({ detached: true, awaitingChildId: "child-1" })
		expect(provider.written).toEqual([
			expect.objectContaining({ id: "parent-1", status: "active", awaitingChildId: undefined }),
		])
	})

	it("re-reads the parent from disk before deciding, so a resume in another window wins", async () => {
		const provider = buildProvider(delegatedParent)
		// Another window already resumed the parent; this store's cache is stale.
		provider.taskHistoryStore.refresh.mockResolvedValueOnce({
			...delegatedParent,
			status: "active",
			awaitingChildId: undefined,
		})

		const result = await (ClineProvider.prototype as any).detachDelegatedParent.call(
			provider,
			"parent-1",
			"child-1",
		)

		expect(result).toEqual({ detached: false })
		expect(provider.written).toEqual([])
	})

	it("does not write a parent back that a concurrent delete removed", async () => {
		const provider = buildProvider(delegatedParent)
		// The parent is deleted between the check and the write (batch delete).
		provider.taskHistoryStore.atomicReadAndUpdate.mockRejectedValueOnce(new Error("not found in cache"))

		await expect(
			(ClineProvider.prototype as any).detachDelegatedParent.call(provider, "parent-1", "child-1"),
		).rejects.toThrow("not found in cache")
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})

	it("detaches from whichever child the parent awaits when no child is given", async () => {
		const provider = buildProvider(delegatedParent)

		const result = await (ClineProvider.prototype as any).detachDelegatedParent.call(provider, "parent-1")

		expect(result).toEqual({ detached: true, awaitingChildId: "child-1" })
	})

	it("leaves a parent that awaits another child alone", async () => {
		const provider = buildProvider({ ...delegatedParent, awaitingChildId: "child-2" })

		const result = await (ClineProvider.prototype as any).detachDelegatedParent.call(
			provider,
			"parent-1",
			"child-1",
		)

		expect(result).toEqual({ detached: false })
		expect(provider.written).toEqual([])
	})

	it("leaves a parent that is not delegated alone", async () => {
		const provider = buildProvider({ ...delegatedParent, status: "active", awaitingChildId: undefined })

		const result = await (ClineProvider.prototype as any).detachDelegatedParent.call(provider, "parent-1")

		expect(result).toEqual({ detached: false })
		expect(provider.written).toEqual([])
	})

	it("updates an open instance of the parent so its next save keeps it active", async () => {
		const provider = buildProvider(delegatedParent) as any
		const openParent = { taskId: "parent-1", setHistoryStatus: vi.fn() }
		const otherProvider = { getCurrentTask: () => openParent }
		const instances = (ClineProvider as any).activeInstances as Set<unknown>
		instances.add(otherProvider)

		const order: string[] = []
		openParent.setHistoryStatus.mockImplementation(() => order.push("instance"))
		const atomic = provider.taskHistoryStore.atomicReadAndUpdate.getMockImplementation()
		provider.taskHistoryStore.atomicReadAndUpdate.mockImplementation(async (...args: any[]) => {
			order.push("history")
			return atomic(...args)
		})

		try {
			await (ClineProvider.prototype as any).detachDelegatedParent.call(provider, "parent-1", "child-1")
		} finally {
			instances.delete(otherProvider)
		}

		expect(openParent.setHistoryStatus).toHaveBeenCalledWith("active")
		// The instance is flipped before the write, so its saves cannot restore "delegated".
		expect(order).toEqual(["instance", "history"])
	})
})

describe("ClineProvider.deleteTaskWithId() and the delegation link", () => {
	function buildProvider(child: Record<string, any>) {
		return {
			getTaskWithId: vi.fn(async (id: string) => {
				if (id === child.id) {
					return { taskDirPath: "/tmp/child", historyItem: { ...child } }
				}
				throw new Error("Task not found")
			}),
			getCurrentTask: vi.fn(() => undefined),
			removeClineFromStack: vi.fn(),
			detachDelegatedParent: vi.fn().mockResolvedValue({ detached: true }),
			taskHistoryStore: { deleteMany: vi.fn().mockResolvedValue(undefined) },
			contextProxy: { globalStorageUri: { fsPath: "/tmp/storage" } },
			cwd: "/tmp/ws",
			postStateToWebview: vi.fn(),
			log: vi.fn(),
		}
	}

	it("detaches a parent that waits for the deleted child", async () => {
		const provider = buildProvider({ id: "child-1", parentTaskId: "parent-1", childIds: [] })

		await (ClineProvider.prototype as any).deleteTaskWithId.call(provider, "child-1")

		expect(provider.detachDelegatedParent).toHaveBeenCalledWith("parent-1", "child-1")
		expect(provider.taskHistoryStore.deleteMany).toHaveBeenCalledWith(["child-1"])
	})

	it("does not detach anything when deleting a top-level task", async () => {
		const provider = buildProvider({ id: "child-1", childIds: [] })

		await (ClineProvider.prototype as any).deleteTaskWithId.call(provider, "child-1")

		expect(provider.detachDelegatedParent).not.toHaveBeenCalled()
	})

	it("still deletes the child when detaching the parent fails", async () => {
		const provider = buildProvider({ id: "child-1", parentTaskId: "parent-1", childIds: [] })
		provider.detachDelegatedParent.mockRejectedValue(new Error("disk full"))

		await (ClineProvider.prototype as any).deleteTaskWithId.call(provider, "child-1")

		expect(provider.taskHistoryStore.deleteMany).toHaveBeenCalledWith(["child-1"])
		expect(provider.log).toHaveBeenCalledWith(expect.stringContaining("Failed to detach parent parent-1"))
	})
})
