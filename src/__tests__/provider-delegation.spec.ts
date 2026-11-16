// npx vitest run __tests__/provider-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import type { HistoryItem } from "@bear-code/types"
import { BearCodeEventName } from "@bear-code/types"
import { ClineProvider } from "../core/webview/ClineProvider"
import * as ProfileValidatorMod from "../shared/ProfileValidator"

const { taskStart } = vi.hoisted(() => ({ taskStart: vi.fn() }))

vi.mock("../core/task/Task", () => {
	class TaskStub {
		public taskId = "child-1"
		public instanceId = "inst"
		public parentTask?: unknown
		constructor(opts: any) {
			this.parentTask = opts.parentTask
		}
		start() {
			taskStart()
		}
	}
	return { Task: TaskStub }
})

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })) },
	ConfigurationTarget: { Global: 1 },
}))

const parentHistoryItem: HistoryItem = {
	id: "parent-1",
	task: "Parent",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	childIds: [],
} as unknown as HistoryItem

/**
 * Minimal taskHistoryStore stub: the parent is present in the cache and
 * atomicReadAndUpdate calls the updater with the parent item.
 */
function makeStoreStub(
	overrides: Partial<{ atomicReadAndUpdate: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }> = {},
) {
	return {
		atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
			updater(parentHistoryItem)
			return []
		}),
		get: vi.fn().mockReturnValue(parentHistoryItem),
		...overrides,
	}
}

const makeParentTask = () => ({ taskId: "parent-1", emit: vi.fn() }) as any

const params = {
	parentTaskId: "parent-1",
	message: "Do something",
	initialTodos: [],
	mode: "code",
}

describe("ClineProvider.delegateParentAndOpenChild()", () => {
	it("persists parent delegation metadata via atomicReadAndUpdate and emits TaskDelegated", async () => {
		const providerEmit = vi.fn()
		const parentTask = makeParentTask()

		const childStart = vi.fn()
		const updateTaskHistory = vi.fn()
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "child-1", start: childStart })
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const getTaskWithId = vi.fn()
		const taskHistoryStore = makeStoreStub()

		const provider = {
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			getTaskWithId,
			updateTaskHistory,
			handleModeSwitch,
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)

		expect(child.taskId).toBe("child-1")

		// Invariant: parent closed before child creation
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		// Child task is created with startTask: false and initialStatus: "active"
		expect(createTask).toHaveBeenCalledWith("Do something", undefined, parentTask, {
			initialTodos: [],
			initialStatus: "active",
			startTask: false,
		})

		// Metadata written atomically, not via a separate read + updateTaskHistory.
		expect(getTaskWithId).not.toHaveBeenCalled()
		expect(updateTaskHistory).not.toHaveBeenCalled()
		expect(taskHistoryStore.atomicReadAndUpdate).toHaveBeenCalledTimes(1)
		const [calledTaskId, updater] = taskHistoryStore.atomicReadAndUpdate.mock.calls[0]
		expect(calledTaskId).toBe("parent-1")

		// The updater must produce the delegation fields.
		expect(updater(parentHistoryItem)).toMatchObject({
			id: "parent-1",
			status: "delegated",
			delegatedToId: "child-1",
			awaitingChildId: "child-1",
			childIds: expect.arrayContaining(["child-1"]),
		})

		// child.start() must be called AFTER parent metadata is persisted
		expect(childStart).toHaveBeenCalledTimes(1)

		// Event emission (provider-level)
		expect(providerEmit).toHaveBeenCalledWith(BearCodeEventName.TaskDelegated, "parent-1", "child-1")

		// Mode switch
		expect(handleModeSwitch).toHaveBeenCalledWith("code")
	})

	it("posts taskHistoryItemUpdated to the webview when the view is launched", async () => {
		const updatedParent = { ...parentHistoryItem, status: "delegated" } as HistoryItem
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const taskHistoryStore = makeStoreStub({ get: vi.fn().mockReturnValue(updatedParent) })

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => makeParentTask()),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview,
			log: vi.fn(),
			isViewLaunched: true,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "taskHistoryItemUpdated",
			taskHistoryItem: updatedParent,
		})
	})

	it("falls back to getTaskWithId + updateTaskHistory when the parent is not in the store cache", async () => {
		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const getTaskWithId = vi.fn().mockResolvedValue({ historyItem: parentHistoryItem })
		const taskHistoryStore = makeStoreStub({ get: vi.fn().mockReturnValue(undefined) })

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => makeParentTask()),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			getTaskWithId,
			updateTaskHistory,
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)

		expect(taskHistoryStore.atomicReadAndUpdate).not.toHaveBeenCalled()
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-1",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: ["child-1"],
			}),
		)
	})

	it("calls child.start() only after atomicReadAndUpdate completes (no race condition)", async () => {
		const callOrder: string[] = []

		const childStart = vi.fn(() => callOrder.push("child.start"))
		const createTask = vi.fn(async () => {
			callOrder.push("createTask")
			return { taskId: "child-1", start: childStart }
		})
		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async () => {
				callOrder.push("atomicReadAndUpdate")
				return []
			}),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => makeParentTask()),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)

		// createTask → atomicReadAndUpdate → child.start: lock must release before start
		expect(callOrder).toEqual(["createTask", "atomicReadAndUpdate", "child.start"])
	})

	it("rolls back the handoff and rethrows when the parent metadata write fails", async () => {
		const callOrder: string[] = []
		const childStart = vi.fn()
		const writeError = new Error("disk full")
		const restoredParent = { ...parentHistoryItem, status: "active" } as HistoryItem
		let current: any = makeParentTask()

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => current),
			removeClineFromStack: vi.fn(async (opts?: { skipDelegationRepair?: boolean }) => {
				callOrder.push(`removeClineFromStack:${opts?.skipDelegationRepair}`)
				current = undefined
			}),
			createTask: vi.fn(async () => {
				current = { taskId: "child-1", start: childStart }
				return current
			}),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId: vi.fn(async (id: string, cascade: boolean) => {
				callOrder.push(`deleteTaskWithId:${id}:${cascade}`)
			}),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: restoredParent }),
			createTaskWithHistoryItem: vi.fn(async (item: HistoryItem) => {
				callOrder.push(`createTaskWithHistoryItem:${item.id}`)
			}),
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore: makeStoreStub({ atomicReadAndUpdate: vi.fn().mockRejectedValue(writeError) }),
		} as unknown as ClineProvider
		;(provider as any).rollbackFailedDelegation = (ClineProvider.prototype as any).rollbackFailedDelegation

		await expect((ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)).rejects.toBe(
			writeError,
		)

		// The child never started and the TaskDelegated event was not emitted.
		expect(childStart).not.toHaveBeenCalled()
		expect((provider as any).emit).not.toHaveBeenCalledWith(
			BearCodeEventName.TaskDelegated,
			expect.anything(),
			expect.anything(),
		)
		// Parent close, child close, child delete (no cascade), parent restore.
		expect(callOrder).toEqual([
			"removeClineFromStack:true",
			"removeClineFromStack:true",
			"deleteTaskWithId:child-1:false",
			"createTaskWithHistoryItem:parent-1",
		])
	})
})

describe("ClineProvider.createTask() startTask option", () => {
	const makeProvider = () =>
		({
			clineStack: [{ taskId: "parent-1" }],
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic" },
				organizationAllowList: "*",
				enableCheckpoints: false,
				checkpointTimeout: 60,
			}),
			removeClineFromStack: vi.fn(),
			addClineToStack: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			customModesManager: { updateCustomMode: vi.fn() },
		}) as unknown as ClineProvider

	it("does not start the task when startTask is false", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		taskStart.mockClear()

		await (ClineProvider.prototype as any).createTask.call(
			makeProvider(),
			"child",
			undefined,
			{ taskId: "p" },
			{
				startTask: false,
			},
		)

		expect(taskStart).not.toHaveBeenCalled()
	})

	it("starts the task by default", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		taskStart.mockClear()

		await (ClineProvider.prototype as any).createTask.call(makeProvider(), "task")

		expect(taskStart).toHaveBeenCalledTimes(1)
	})
})
