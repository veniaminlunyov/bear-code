// npx vitest run __tests__/provider-pending-action.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { HistoryItem, PendingTaskAction } from "@bear-code/types"

vi.mock("../core/task/Task", () => ({ Task: class {} }))

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })) },
	ConfigurationTarget: { Global: 1 },
}))

vi.mock("../core/task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))
vi.mock("../core/task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

import { ClineProvider, PendingActionSettledError } from "../core/webview/ClineProvider"

const createAction: PendingTaskAction = {
	kind: "create_subtask",
	actionId: "call_new",
	approvalText: '{"tool":"newTask"}',
	mode: "code",
	message: "Do it",
	todos: [],
}

const finishAction: PendingTaskAction = {
	kind: "finish_subtask",
	actionId: "call_finish",
	approvalText: '{"tool":"finishTask"}',
	parentTaskId: "parent-1",
	result: "Done",
}

const item = (id: string, extra: Partial<HistoryItem> = {}): HistoryItem =>
	({ id, number: 1, ts: 1, task: id, tokensIn: 0, tokensOut: 0, totalCost: 0, ...extra }) as HistoryItem

/** In-memory store with the TaskHistoryStore methods the provider uses. */
function makeStore(records: Record<string, HistoryItem>) {
	return {
		records,
		get: vi.fn((id: string) => records[id]),
		refresh: vi.fn(async (id: string) => records[id]),
		atomicReadAndUpdate: vi.fn(async (id: string, updater: (h: HistoryItem) => HistoryItem) => {
			if (!records[id]) {
				throw new Error(`[TaskHistoryStore] atomicReadAndUpdate: task ${id} not found in cache`)
			}
			records[id] = updater({ ...records[id] })
			return []
		}),
		atomicUpdatePair: vi.fn(
			async (
				firstId: string,
				secondId: string,
				first: (h: HistoryItem) => HistoryItem,
				second: (h: HistoryItem) => HistoryItem,
			) => {
				records[firstId] = first({ ...records[firstId] })
				records[secondId] = second({ ...records[secondId] })
				return []
			},
		),
	}
}

describe("ClineProvider pending subtask approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("setPendingTaskAction / clearPendingTaskAction", () => {
		it("saves the approval and clears it only while it is still the same one", async () => {
			const store = makeStore({ t1: item("t1") })
			const provider = { taskHistoryStore: store, log: vi.fn() } as any

			await (ClineProvider.prototype as any).setPendingTaskAction.call(provider, "t1", createAction)
			expect(store.records.t1.pendingAction).toEqual(createAction)

			// A different action id leaves the newer approval alone.
			await expect(
				(ClineProvider.prototype as any).clearPendingTaskAction.call(provider, "t1", "call_other"),
			).resolves.toBe(false)
			expect(store.records.t1.pendingAction).toEqual(createAction)

			await expect(
				(ClineProvider.prototype as any).clearPendingTaskAction.call(provider, "t1", "call_new"),
			).resolves.toBe(true)
			expect(store.records.t1.pendingAction).toBeUndefined()
		})

		it("does nothing for a task that is not in the store", async () => {
			const store = makeStore({})
			const provider = { taskHistoryStore: store, log: vi.fn() } as any

			await (ClineProvider.prototype as any).setPendingTaskAction.call(provider, "gone", createAction)
			await expect(
				(ClineProvider.prototype as any).clearPendingTaskAction.call(provider, "gone", "call_new"),
			).resolves.toBe(false)
			expect(store.atomicReadAndUpdate).not.toHaveBeenCalled()
		})

		it("returns false when the task is deleted between the check and the write", async () => {
			const store = makeStore({ t1: item("t1", { pendingAction: createAction }) })
			store.atomicReadAndUpdate.mockRejectedValueOnce(new Error("not found in cache"))
			const provider = { taskHistoryStore: store, log: vi.fn() } as any

			await expect(
				(ClineProvider.prototype as any).clearPendingTaskAction.call(provider, "t1", "call_new"),
			).resolves.toBe(false)
		})
	})

	describe("delegateParentAndOpenChild with a saved approval", () => {
		const delegateParams = {
			parentTaskId: "parent-1",
			message: "Do it",
			initialTodos: [],
			mode: "code",
			pendingActionId: "call_new",
		}

		function makeProvider(store: ReturnType<typeof makeStore>, overrides: Record<string, unknown> = {}) {
			const parentTask = { taskId: "parent-1", emit: vi.fn(), flushPendingToolResultsToHistory: vi.fn() }
			let current: any = parentTask

			return {
				parentTask,
				emit: vi.fn(),
				log: vi.fn(),
				isViewLaunched: false,
				taskHistoryStore: store,
				getCurrentTask: vi.fn(() => current),
				removeClineFromStack: vi.fn(async () => {
					current = undefined
				}),
				createTask: vi.fn(async () => {
					current = { taskId: "child-1", start: vi.fn() }
					return current
				}),
				resolveHandoffExecutionContext: vi.fn().mockResolvedValue({
					mode: "code",
					apiConfigName: "p",
					apiConfiguration: {},
				}),
				mirrorExecutionContextToProvider: vi.fn(),
				stampDelegationChildLink: vi.fn(),
				deleteTaskWithId: vi.fn(),
				getTaskWithId: vi.fn(async (id: string) => ({ historyItem: store.records[id] })),
				createTaskWithHistoryItem: vi.fn(),
				clearPendingTaskAction: ClineProvider.prototype.clearPendingTaskAction,
				rollbackFailedDelegation: (ClineProvider.prototype as any).rollbackFailedDelegation,
				...overrides,
			} as any
		}

		it("refuses, before closing anything, an approval that is no longer pending", async () => {
			const store = makeStore({ "parent-1": item("parent-1") })
			const provider = makeProvider(store)

			await expect(
				(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, delegateParams),
			).rejects.toBeInstanceOf(PendingActionSettledError)

			expect(provider.removeClineFromStack).not.toHaveBeenCalled()
			expect(provider.createTask).not.toHaveBeenCalled()
		})

		it("clears the approval in the same write that delegates the parent", async () => {
			const store = makeStore({ "parent-1": item("parent-1", { pendingAction: createAction }) })
			const provider = makeProvider(store)

			await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, delegateParams)

			expect(store.records["parent-1"]).toMatchObject({ status: "delegated", awaitingChildId: "child-1" })
			expect(store.records["parent-1"].pendingAction).toBeUndefined()
		})

		it("lets only one of two panels settle the same approval", async () => {
			const store = makeStore({ "parent-1": item("parent-1", { pendingAction: createAction }) })
			const first = makeProvider(store)
			const second = makeProvider(store)

			await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(first, delegateParams)
			await expect(
				(ClineProvider.prototype as any).delegateParentAndOpenChild.call(second, delegateParams),
			).rejects.toBeInstanceOf(PendingActionSettledError)

			expect(first.createTask).toHaveBeenCalledTimes(1)
			expect(second.createTask).not.toHaveBeenCalled()
		})

		it("closes the parent where another panel has it open", async () => {
			const store = makeStore({ "parent-1": item("parent-1", { pendingAction: createAction }) })
			const provider = makeProvider(store)
			const otherPanel = { getCurrentTask: () => ({ taskId: "parent-1" }), removeClineFromStack: vi.fn() }
			const instances = (ClineProvider as any).activeInstances as Set<unknown>
			instances.add(otherPanel)

			try {
				await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, delegateParams)
			} finally {
				instances.delete(otherPanel)
			}

			expect(otherPanel.removeClineFromStack).toHaveBeenCalledTimes(1)
		})

		it("clears the approval before reopening the parent when the child cannot be created", async () => {
			const store = makeStore({ "parent-1": item("parent-1", { pendingAction: createAction }) })
			const order: string[] = []
			const provider = makeProvider(store, {
				createTask: vi.fn().mockRejectedValue(new Error("mode not allowed")),
				createTaskWithHistoryItem: vi.fn(async (historyItem: HistoryItem) => {
					order.push(`reopen with ${historyItem.pendingAction ? "approval" : "no approval"}`)
				}),
			})

			await expect(
				(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, delegateParams),
			).rejects.toThrow("mode not allowed")

			// Otherwise the reopened parent would ask again, fail again, on every open.
			expect(store.records["parent-1"].pendingAction).toBeUndefined()
			expect(order).toEqual(["reopen with no approval"])
		})
	})

	describe("reopenParentFromDelegation with a saved approval", () => {
		function makeProvider(store: ReturnType<typeof makeStore>) {
			return {
				contextProxy: { globalStorageUri: { fsPath: "/storage" } },
				log: vi.fn(),
				emit: vi.fn(),
				isViewLaunched: false,
				taskHistoryStore: store,
				getTaskWithId: vi.fn(async (id: string) => {
					if (!store.records[id]) throw new Error("Task not found")
					return { historyItem: store.records[id] }
				}),
				getCurrentTask: vi.fn(() => ({ taskId: "child-1" })),
				removeClineFromStack: vi.fn(),
				updateTaskHistory: vi.fn(),
				createTaskWithHistoryItem: vi.fn().mockResolvedValue({
					taskId: "parent-1",
					overwriteClineMessages: vi.fn(),
					overwriteApiConversationHistory: vi.fn(),
					resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				}),
			} as any
		}

		const handBack = {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "Done",
			pendingActionId: "call_finish",
		}

		it("clears the child's approval in the hand-back write", async () => {
			const store = makeStore({
				"parent-1": item("parent-1", { status: "delegated", awaitingChildId: "child-1" }),
				"child-1": item("child-1", { status: "active", parentTaskId: "parent-1", pendingAction: finishAction }),
			})

			await expect(
				(ClineProvider.prototype as any).reopenParentFromDelegation.call(makeProvider(store), handBack),
			).resolves.toBe(true)

			expect(store.records["child-1"]).toMatchObject({ status: "completed" })
			expect(store.records["child-1"].pendingAction).toBeUndefined()
		})

		it("does not hand back an approval that is no longer pending", async () => {
			const store = makeStore({
				"parent-1": item("parent-1", { status: "delegated", awaitingChildId: "child-1" }),
				"child-1": item("child-1", { status: "active", parentTaskId: "parent-1" }),
			})
			const provider = makeProvider(store)

			await expect(
				(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, handBack),
			).resolves.toBe(false)

			expect(store.records["parent-1"].status).toBe("delegated")
			expect(provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
		})

		it("returns false when the parent was deleted", async () => {
			const store = makeStore({
				"child-1": item("child-1", { status: "active", parentTaskId: "parent-1", pendingAction: finishAction }),
			})

			await expect(
				(ClineProvider.prototype as any).reopenParentFromDelegation.call(makeProvider(store), handBack),
			).resolves.toBe(false)
		})
	})
})
