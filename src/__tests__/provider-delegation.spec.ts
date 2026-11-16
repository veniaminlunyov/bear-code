// npx vitest run __tests__/provider-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import type { HistoryItem } from "@bear-code/types"
import { BearCodeEventName } from "@bear-code/types"
import { ClineProvider } from "../core/webview/ClineProvider"
import * as ProfileValidatorMod from "../shared/ProfileValidator"
import * as vscode from "vscode"

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

const handoffContext = {
	mode: "code",
	apiConfigName: "parent-profile",
	apiConfiguration: { apiProvider: "anthropic" },
}

/** Delegation helpers the provider stubs need (handoff selection is covered separately). */
const handoffStubs = () => ({
	resolveHandoffExecutionContext: vi.fn().mockResolvedValue(handoffContext),
	mirrorExecutionContextToProvider: vi.fn().mockResolvedValue(undefined),
})

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
		const stubs = handoffStubs()
		const getTaskWithId = vi.fn()
		const taskHistoryStore = makeStoreStub()

		const provider = {
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			getTaskWithId,
			updateTaskHistory,
			...stubs,
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)

		expect(child.taskId).toBe("child-1")

		// Invariant: parent closed before child creation
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		// Child task is created with startTask: false, initialStatus: "active" and the
		// execution context chosen from the parent.
		expect(createTask).toHaveBeenCalledWith("Do something", undefined, parentTask, {
			initialTodos: [],
			initialStatus: "active",
			startTask: false,
			handoffExecutionContext: handoffContext,
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

		// The child's context is chosen from the parent and only mirrored into the UI.
		expect(stubs.resolveHandoffExecutionContext).toHaveBeenCalledWith(parentTask, "code")
		expect(stubs.mirrorExecutionContextToProvider).toHaveBeenCalledWith(handoffContext)
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
			...handoffStubs(),
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
			...handoffStubs(),
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
			...handoffStubs(),
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
			...handoffStubs(),
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

	it("reopens the parent when the child cannot be created", async () => {
		const callOrder: string[] = []
		const createError = new Error("profile not allowed")
		const restoredParent = { ...parentHistoryItem, status: "active" } as HistoryItem
		let current: any = makeParentTask()

		const provider = {
			...handoffStubs(),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => current),
			removeClineFromStack: vi.fn(async (opts?: { skipDelegationRepair?: boolean }) => {
				callOrder.push(`removeClineFromStack:${opts?.skipDelegationRepair}`)
				current = undefined
			}),
			createTask: vi.fn().mockRejectedValue(createError),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId: vi.fn(),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: restoredParent }),
			createTaskWithHistoryItem: vi.fn(async (item: HistoryItem) => {
				callOrder.push(`createTaskWithHistoryItem:${item.id}`)
			}),
			log: vi.fn(),
			isViewLaunched: false,
			taskHistoryStore: makeStoreStub(),
		} as unknown as ClineProvider
		;(provider as any).rollbackFailedDelegation = (ClineProvider.prototype as any).rollbackFailedDelegation

		await expect((ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, params)).rejects.toBe(
			createError,
		)

		// Nothing to delete: no child was created. The parent is reopened.
		expect((provider as any).deleteTaskWithId).not.toHaveBeenCalled()
		expect(callOrder).toEqual(["removeClineFromStack:true", "createTaskWithHistoryItem:parent-1"])
		expect(vscode.window.showErrorMessage).toHaveBeenCalled()
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

describe("ClineProvider delegation execution context", () => {
	const parentConfig = { apiProvider: "anthropic", apiModelId: "parent-model" }
	const makeParent = (mode = "orchestrator") =>
		({
			getTaskMode: vi.fn().mockResolvedValue(mode),
			getTaskApiConfigName: vi.fn().mockResolvedValue("parent-profile"),
			apiConfiguration: parentConfig,
		}) as any

	const makeProvider = (opts: { locked?: boolean; savedConfigId?: string; profile?: any } = {}) =>
		({
			context: { workspaceState: { get: vi.fn(() => opts.locked ?? false) } },
			providerSettingsManager: {
				getModeConfigId: vi.fn().mockResolvedValue(opts.savedConfigId),
				getProfile: vi.fn().mockResolvedValue(opts.profile),
			},
			log: vi.fn(),
		}) as any

	const resolve = (provider: any, parent: any, mode: string) =>
		(ClineProvider.prototype as any).resolveHandoffExecutionContext.call(provider, parent, mode)

	it("gives the child the profile saved for its mode", async () => {
		const provider = makeProvider({
			savedConfigId: "id-code",
			profile: { id: "id-code", name: "code-profile", apiProvider: "openai", openAiModelId: "m" },
		})

		await expect(resolve(provider, makeParent(), "code")).resolves.toEqual({
			mode: "code",
			apiConfigName: "code-profile",
			apiConfiguration: { apiProvider: "openai", openAiModelId: "m" },
		})
		expect(provider.providerSettingsManager.getProfile).toHaveBeenCalledWith({ id: "id-code" })
	})

	it("inherits the parent's task-local profile when profiles are locked across modes", async () => {
		const provider = makeProvider({ locked: true, savedConfigId: "id-code" })

		const context = await resolve(provider, makeParent(), "code")

		expect(context).toEqual({ mode: "code", apiConfigName: "parent-profile", apiConfiguration: parentConfig })
		expect(context.apiConfiguration).not.toBe(parentConfig)
		expect(provider.providerSettingsManager.getModeConfigId).not.toHaveBeenCalled()
	})

	it("falls back to the parent's profile when the saved profile cannot be loaded", async () => {
		const provider = makeProvider({ savedConfigId: "id-gone" })
		provider.providerSettingsManager.getProfile.mockRejectedValue(new Error("Config with ID 'id-gone' not found"))

		await expect(resolve(provider, makeParent(), "code")).resolves.toMatchObject({
			mode: "code",
			apiConfigName: "parent-profile",
		})
	})

	it("mirrors the child's mode and profile into the UI without persisting defaults", async () => {
		const provider = {
			updateGlobalState: vi.fn(),
			emit: vi.fn(),
			getState: vi.fn().mockResolvedValue({ currentApiConfigName: "parent-profile" }),
			activateProviderProfile: vi.fn(),
			log: vi.fn(),
		} as any

		await (ClineProvider.prototype as any).mirrorExecutionContextToProvider.call(provider, {
			mode: "code",
			apiConfigName: "code-profile",
			apiConfiguration: {},
		})

		expect(provider.updateGlobalState).toHaveBeenCalledWith("mode", "code")
		expect(provider.emit).toHaveBeenCalledWith(BearCodeEventName.ModeChanged, "code")
		expect(provider.activateProviderProfile).toHaveBeenCalledWith(
			{ name: "code-profile" },
			{ persistModeConfig: false, persistTaskHistory: false },
		)
	})

	it("does not re-activate the profile that is already current", async () => {
		const provider = {
			updateGlobalState: vi.fn(),
			emit: vi.fn(),
			getState: vi.fn().mockResolvedValue({ currentApiConfigName: "parent-profile" }),
			activateProviderProfile: vi.fn(),
			log: vi.fn(),
		} as any

		await (ClineProvider.prototype as any).mirrorExecutionContextToProvider.call(provider, {
			mode: "code",
			apiConfigName: "parent-profile",
			apiConfiguration: {},
		})

		expect(provider.activateProviderProfile).not.toHaveBeenCalled()
	})
})
