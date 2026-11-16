// npx vitest run __tests__/history-resume-delegation.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { BearCodeEventName } from "@bear-code/types"

/* vscode mock for Task/Provider imports */
vi.mock("vscode", () => {
	const window = {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	}
	const workspace = {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((_key: string, defaultValue: any) => defaultValue),
			update: vi.fn(),
		})),
		workspaceFolders: [],
	}
	const env = { machineId: "test-machine", uriScheme: "vscode", appName: "VSCode", language: "en", sessionId: "sess" }
	const Uri = { file: (p: string) => ({ fsPath: p, toString: () => p }) }
	const commands = { executeCommand: vi.fn() }
	const ExtensionMode = { Development: 2 }
	const version = "1.0.0-test"
	return { window, workspace, env, Uri, commands, ExtensionMode, version }
})

// Mock persistence BEFORE importing provider
vi.mock("../core/task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))
vi.mock("../core/task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

import { ClineProvider } from "../core/webview/ClineProvider"
import { readTaskMessages } from "../core/task-persistence/taskMessages"
import { readApiMessages, saveApiMessages, saveTaskMessages } from "../core/task-persistence"

/** Store stub with an empty cache: forces the sequential (non-atomic) fallback path. */
const legacyHistoryStore = { get: () => undefined, refresh: async () => undefined }

describe("History resume delegation - parent metadata transitions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reopenParentFromDelegation persists parent metadata (delegated → active) before reopen", async () => {
		const providerEmit = vi.fn()
		const getTaskWithId = vi.fn().mockResolvedValue({
			historyItem: {
				id: "parent-1",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: ["child-1"],
				ts: Date.now(),
				task: "Parent task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				mode: "code",
				workspace: "/tmp",
			},
		})

		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue({
			taskId: "parent-1",
			skipPrevResponseIdOnce: false,
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
		})

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId,
			emit: providerEmit,
			getCurrentTask: vi.fn(() => ({ taskId: "child-1" })),
			removeClineFromStack,
			createTaskWithHistoryItem,
			updateTaskHistory,
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		// Mock persistence reads to return empty arrays
		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "Child done",
		})

		// Assert: metadata updated BEFORE createTaskWithHistoryItem
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-1",
				status: "active",
				completedByChildId: "child-1",
				completionResultSummary: "Child done",
				awaitingChildId: undefined,
				childIds: ["child-1"],
			}),
		)

		// Verify call ordering: updateTaskHistory before createTaskWithHistoryItem
		const updateCall = updateTaskHistory.mock.invocationCallOrder[0]
		const createCall = createTaskWithHistoryItem.mock.invocationCallOrder[0]
		expect(updateCall).toBeLessThan(createCall)

		// Verify child closed and parent reopened with updated metadata
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "active",
				completedByChildId: "child-1",
			}),
			{ startTask: false },
		)
	})

	it("reopenParentFromDelegation injects subtask_result into both UI and API histories", async () => {
		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/storage" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p1",
					status: "delegated",
					awaitingChildId: "c1",
					childIds: [],
					ts: 100,
					task: "Parent",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "c1" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				taskId: "p1",
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		// Start with existing messages in history
		const existingUiMessages = [{ type: "ask", ask: "tool", text: "Old tool", ts: 50 }]
		const existingApiMessages = [{ role: "user", content: [{ type: "text", text: "Old request" }], ts: 50 }]

		vi.mocked(readTaskMessages).mockResolvedValue(existingUiMessages as any)
		vi.mocked(readApiMessages).mockResolvedValue(existingApiMessages as any)

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "p1",
			childTaskId: "c1",
			completionResultSummary: "Subtask completed successfully",
		})

		// Verify UI history injection (say: subtask_result)
		expect(saveTaskMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						type: "say",
						say: "subtask_result",
						text: "Subtask completed successfully",
					}),
				]),
				taskId: "p1",
				globalStoragePath: "/storage",
			}),
		)

		// Verify API history injection (user role message)
		expect(saveApiMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								text: expect.stringContaining("Subtask c1 completed"),
							}),
						]),
					}),
				]),
				taskId: "p1",
				globalStoragePath: "/storage",
			}),
		)

		// Verify both include original messages
		const uiCall = vi.mocked(saveTaskMessages).mock.calls[0][0]
		expect(uiCall.messages).toHaveLength(2) // 1 original + 1 injected

		const apiCall = vi.mocked(saveApiMessages).mock.calls[0][0]
		expect(apiCall.messages).toHaveLength(2) // 1 original + 1 injected
	})

	it("reopenParentFromDelegation injects tool_result when new_task tool_use exists in API history", async () => {
		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/storage" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p-tool",
					status: "delegated",
					awaitingChildId: "c-tool",
					childIds: [],
					ts: 100,
					task: "Parent with tool_use",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "c-tool" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				taskId: "p-tool",
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		// Include an assistant message with new_task tool_use to exercise the tool_result path
		const existingUiMessages = [{ type: "ask", ask: "tool", text: "new_task request", ts: 50 }]
		const existingApiMessages = [
			{ role: "user", content: [{ type: "text", text: "Create a subtask" }], ts: 40 },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: "new_task",
						id: "toolu_abc123",
						input: { mode: "code", message: "Do something" },
					},
				],
				ts: 50,
			},
		]

		vi.mocked(readTaskMessages).mockResolvedValue(existingUiMessages as any)
		vi.mocked(readApiMessages).mockResolvedValue(existingApiMessages as any)

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "p-tool",
			childTaskId: "c-tool",
			completionResultSummary: "Subtask completed via tool_result",
		})

		// Verify API history injection uses tool_result (not text fallback)
		expect(saveApiMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "tool_result",
								tool_use_id: "toolu_abc123",
								content: expect.stringContaining("Subtask c-tool completed"),
							}),
						]),
					}),
				]),
				taskId: "p-tool",
				globalStoragePath: "/storage",
			}),
		)

		// Verify total message count: 2 original + 1 injected user message with tool_result
		const apiCall = vi.mocked(saveApiMessages).mock.calls[0][0]
		expect(apiCall.messages).toHaveLength(3)

		// Verify the injected message is a user message with tool_result type
		const injectedMsg = apiCall.messages[2]
		expect(injectedMsg.role).toBe("user")
		expect((injectedMsg.content[0] as any).type).toBe("tool_result")
		expect((injectedMsg.content[0] as any).tool_use_id).toBe("toolu_abc123")
	})

	it("reopenParentFromDelegation injects plain text when no new_task tool_use exists in API history", async () => {
		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/storage" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p-no-tool",
					status: "delegated",
					awaitingChildId: "c-no-tool",
					childIds: [],
					ts: 100,
					task: "Parent without tool_use",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "c-no-tool" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				taskId: "p-no-tool",
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		// No assistant tool_use in history
		const existingUiMessages = [{ type: "ask", ask: "tool", text: "subtask request", ts: 50 }]
		const existingApiMessages = [{ role: "user", content: [{ type: "text", text: "Create a subtask" }], ts: 40 }]

		vi.mocked(readTaskMessages).mockResolvedValue(existingUiMessages as any)
		vi.mocked(readApiMessages).mockResolvedValue(existingApiMessages as any)

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "p-no-tool",
			childTaskId: "c-no-tool",
			completionResultSummary: "Subtask completed without tool_use",
		})

		const apiCall = vi.mocked(saveApiMessages).mock.calls[0][0]
		// Should append a user text note
		expect(apiCall.messages).toHaveLength(2)
		const injected = apiCall.messages[1]
		expect(injected.role).toBe("user")
		expect((injected.content[0] as any).type).toBe("text")
		expect((injected.content[0] as any).text).toContain("Subtask c-no-tool completed")
	})

	it("reopenParentFromDelegation sets skipPrevResponseIdOnce via resumeAfterDelegation", async () => {
		const parentInstance: any = {
			skipPrevResponseIdOnce: false,
			resumeAfterDelegation: vi.fn().mockImplementation(async function (this: any) {
				// Simulate what the real resumeAfterDelegation does
				this.skipPrevResponseIdOnce = true
			}),
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		}

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "parent-2",
					status: "delegated",
					awaitingChildId: "child-2",
					childIds: [],
					ts: 200,
					task: "P",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "child-2" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(parentInstance),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "parent-2",
			childTaskId: "child-2",
			completionResultSummary: "Done",
		})

		// Critical: verify skipPrevResponseIdOnce set to true by resumeAfterDelegation
		expect(parentInstance.skipPrevResponseIdOnce).toBe(true)
		expect(parentInstance.resumeAfterDelegation).toHaveBeenCalledTimes(1)
	})

	it("reopenParentFromDelegation emits events in correct order: TaskDelegationCompleted → TaskDelegationResumed", async () => {
		const emitSpy = vi.fn()
		const updateTaskHistory = vi.fn().mockResolvedValue([])

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p3",
					status: "delegated",
					awaitingChildId: "c3",
					childIds: [],
					ts: 300,
					task: "P3",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: emitSpy,
			getCurrentTask: vi.fn(() => ({ taskId: "c3" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory,
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "p3",
			childTaskId: "c3",
			completionResultSummary: "Summary",
		})

		// Verify both events emitted
		const eventNames = emitSpy.mock.calls.map((c) => c[0])
		expect(eventNames).toContain(BearCodeEventName.TaskDelegationCompleted)
		expect(eventNames).toContain(BearCodeEventName.TaskDelegationResumed)

		// CRITICAL: verify ordering (TaskDelegationCompleted before TaskDelegationResumed)
		const completedIdx = emitSpy.mock.calls.findIndex((c) => c[0] === BearCodeEventName.TaskDelegationCompleted)
		const resumedIdx = emitSpy.mock.calls.findIndex((c) => c[0] === BearCodeEventName.TaskDelegationResumed)
		expect(completedIdx).toBeGreaterThanOrEqual(0)
		expect(resumedIdx).toBeGreaterThan(completedIdx)

		// RPD-05: verify parent metadata persistence happens before TaskDelegationCompleted emit
		const parentUpdateCallIdx = updateTaskHistory.mock.calls.findIndex((call) => {
			const item = call[0] as { id?: string; status?: string } | undefined
			return item?.id === "p3" && item.status === "active"
		})
		expect(parentUpdateCallIdx).toBeGreaterThanOrEqual(0)

		const parentUpdateCallOrder = updateTaskHistory.mock.invocationCallOrder[parentUpdateCallIdx]
		const completedEmitCallOrder = emitSpy.mock.invocationCallOrder[completedIdx]
		expect(parentUpdateCallOrder).toBeLessThan(completedEmitCallOrder)
	})

	it("reopenParentFromDelegation continues when overwrite operations fail and still resumes/emits (RPD-06)", async () => {
		const emitSpy = vi.fn()
		const parentInstance = {
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn().mockRejectedValue(new Error("ui overwrite failed")),
			overwriteApiConversationHistory: vi.fn().mockRejectedValue(new Error("api overwrite failed")),
		}

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockImplementation(async (id: string) => {
				if (id === "parent-rpd06") {
					return {
						historyItem: {
							id: "parent-rpd06",
							status: "delegated",
							awaitingChildId: "child-rpd06",
							childIds: ["child-rpd06"],
							ts: 800,
							task: "Parent RPD-06",
							tokensIn: 0,
							tokensOut: 0,
							totalCost: 0,
						},
					}
				}

				return {
					historyItem: {
						id: "child-rpd06",
						status: "active",
						ts: 801,
						task: "Child RPD-06",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
					},
				}
			}),
			emit: emitSpy,
			getCurrentTask: vi.fn(() => ({ taskId: "child-rpd06" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(parentInstance),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await expect(
			(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
				parentTaskId: "parent-rpd06",
				childTaskId: "child-rpd06",
				completionResultSummary: "Subtask finished despite overwrite failures",
			}),
		).resolves.toBe(true)

		expect(parentInstance.overwriteClineMessages).toHaveBeenCalledTimes(1)
		expect(parentInstance.overwriteApiConversationHistory).toHaveBeenCalledTimes(1)
		expect(parentInstance.resumeAfterDelegation).toHaveBeenCalledTimes(1)

		expect(emitSpy).toHaveBeenCalledWith(
			BearCodeEventName.TaskDelegationCompleted,
			"parent-rpd06",
			"child-rpd06",
			"Subtask finished despite overwrite failures",
		)
		expect(emitSpy).toHaveBeenCalledWith(BearCodeEventName.TaskDelegationResumed, "parent-rpd06", "child-rpd06")

		const completedIdx = emitSpy.mock.calls.findIndex((c) => c[0] === BearCodeEventName.TaskDelegationCompleted)
		const resumedIdx = emitSpy.mock.calls.findIndex((c) => c[0] === BearCodeEventName.TaskDelegationResumed)
		expect(completedIdx).toBeGreaterThanOrEqual(0)
		expect(resumedIdx).toBeGreaterThan(completedIdx)
	})

	it("reopenParentFromDelegation does NOT emit TaskPaused or TaskUnpaused (new flow only)", async () => {
		const emitSpy = vi.fn()

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p4",
					status: "delegated",
					awaitingChildId: "c4",
					childIds: [],
					ts: 400,
					task: "P4",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: emitSpy,
			getCurrentTask: vi.fn(() => ({ taskId: "c4" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "p4",
			childTaskId: "c4",
			completionResultSummary: "S",
		})

		// CRITICAL: verify legacy pause/unpause events NOT emitted
		const eventNames = emitSpy.mock.calls.map((c) => c[0])
		expect(eventNames).not.toContain(BearCodeEventName.TaskPaused)
		expect(eventNames).not.toContain(BearCodeEventName.TaskUnpaused)
		expect(eventNames).not.toContain(BearCodeEventName.TaskSpawned)
	})

	it("reopenParentFromDelegation skips child close when current task differs and still reopens parent (RPD-02)", async () => {
		const parentInstance = {
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		}

		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue(parentInstance)

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockImplementation(async (id: string) => {
				if (id === "parent-rpd02") {
					return {
						historyItem: {
							id: "parent-rpd02",
							status: "delegated",
							awaitingChildId: "child-rpd02",
							childIds: ["child-rpd02"],
							ts: 600,
							task: "Parent RPD-02",
							tokensIn: 0,
							tokensOut: 0,
							totalCost: 0,
						},
					}
				}
				return {
					historyItem: {
						id: "child-rpd02",
						status: "active",
						ts: 601,
						task: "Child RPD-02",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
					},
				}
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "different-open-task" })),
			removeClineFromStack,
			createTaskWithHistoryItem,
			updateTaskHistory,
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "parent-rpd02",
			childTaskId: "child-rpd02",
			completionResultSummary: "Child done without being current",
		})

		expect(removeClineFromStack).not.toHaveBeenCalled()
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "child-rpd02",
				status: "completed",
			}),
		)
		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-rpd02",
				status: "active",
				completedByChildId: "child-rpd02",
			}),
			{ startTask: false },
		)
		expect(parentInstance.resumeAfterDelegation).toHaveBeenCalledTimes(1)
	})

	it("reopenParentFromDelegation logs child status persistence failure and continues reopen flow (RPD-04)", async () => {
		const logSpy = vi.fn()
		const emitSpy = vi.fn()
		const parentInstance = {
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		}

		const updateTaskHistory = vi.fn().mockImplementation(async (historyItem: { id?: string }) => {
			if (historyItem.id === "child-rpd04") {
				throw new Error("child status persist failed")
			}
			return []
		})

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockImplementation(async (id: string) => {
				if (id === "parent-rpd04") {
					return {
						historyItem: {
							id: "parent-rpd04",
							status: "delegated",
							awaitingChildId: "child-rpd04",
							childIds: ["child-rpd04"],
							ts: 700,
							task: "Parent RPD-04",
							tokensIn: 0,
							tokensOut: 0,
							totalCost: 0,
						},
					}
				}
				return {
					historyItem: {
						id: "child-rpd04",
						status: "active",
						ts: 701,
						task: "Child RPD-04",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
					},
				}
			}),
			emit: emitSpy,
			log: logSpy,
			getCurrentTask: vi.fn(() => ({ taskId: "child-rpd04" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(parentInstance),
			updateTaskHistory,
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await expect(
			(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
				parentTaskId: "parent-rpd04",
				childTaskId: "child-rpd04",
				completionResultSummary: "Child completion with persistence failure",
			}),
		).resolves.toBe(true)

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"[reopenParentFromDelegation] Failed to persist child completed status for child-rpd04:",
			),
		)
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-rpd04",
				status: "active",
				completedByChildId: "child-rpd04",
			}),
		)
		expect(parentInstance.resumeAfterDelegation).toHaveBeenCalledTimes(1)
		expect(emitSpy).toHaveBeenCalledWith(BearCodeEventName.TaskDelegationResumed, "parent-rpd04", "child-rpd04")
	})

	it("reopenParentFromDelegation updates child and parent atomically from the stored records", async () => {
		const staleParent = {
			id: "parent-atomic",
			status: "delegated",
			delegatedToId: "child-atomic",
			awaitingChildId: "child-atomic",
			childIds: ["child-atomic"],
			ts: 1,
			task: "Parent",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		// The stored records changed after the step-1 read (e.g. a concurrent token save).
		const records: Record<string, any> = {
			"parent-atomic": { ...staleParent, tokensOut: 42 },
			"child-atomic": { id: "child-atomic", status: "active", parentTaskId: "parent-atomic", tokensOut: 7 },
		}
		const taskHistoryStore = {
			get: vi.fn((id: string) => records[id]),
			refresh: vi.fn(async (id: string) => records[id]),
			atomicUpdatePair: vi.fn(
				async (firstId: string, secondId: string, firstUpdater: any, secondUpdater: any) => {
					records[firstId] = firstUpdater({ ...records[firstId] })
					records[secondId] = secondUpdater({ ...records[secondId] })
					return Object.values(records)
				},
			),
		}
		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue({
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		})

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: staleParent }),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "child-atomic" })),
			removeClineFromStack,
			createTaskWithHistoryItem,
			updateTaskHistory,
			postMessageToWebview,
			isViewLaunched: true,
			taskHistoryStore,
		} as unknown as ClineProvider

		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
			parentTaskId: "parent-atomic",
			childTaskId: "child-atomic",
			completionResultSummary: "Atomic done",
		})

		// Child closed; the parent is updated atomically with the child below
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(updateTaskHistory).not.toHaveBeenCalled()
		expect(taskHistoryStore.atomicUpdatePair).toHaveBeenCalledWith(
			"child-atomic",
			"parent-atomic",
			expect.any(Function),
			expect.any(Function),
		)
		// The child close happens before the completed write
		expect(removeClineFromStack.mock.invocationCallOrder[0]).toBeLessThan(
			taskHistoryStore.atomicUpdatePair.mock.invocationCallOrder[0],
		)

		expect(records["child-atomic"]).toMatchObject({ status: "completed", tokensOut: 7 })
		expect(records["parent-atomic"]).toMatchObject({
			status: "active",
			completedByChildId: "child-atomic",
			completionResultSummary: "Atomic done",
			awaitingChildId: undefined,
			childIds: ["child-atomic"],
			// Built from the stored record, not the stale step-1 snapshot
			tokensOut: 42,
		})

		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(records["parent-atomic"], { startTask: false })
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "taskHistoryItemUpdated",
			taskHistoryItem: records["child-atomic"],
		})
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "taskHistoryItemUpdated",
			taskHistoryItem: records["parent-atomic"],
		})
	})

	it("handles empty history gracefully when injecting synthetic messages", async () => {
		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: {
					id: "p5",
					status: "delegated",
					awaitingChildId: "c5",
					childIds: [],
					ts: 500,
					task: "P5",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}),
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => ({ taskId: "c5" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
		} as unknown as ClineProvider

		// Mock read failures or empty returns
		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		await expect(
			(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
				parentTaskId: "p5",
				childTaskId: "c5",
				completionResultSummary: "Result",
			}),
		).resolves.toBe(true)

		// Verify saves still occurred with just the injected message
		expect(saveTaskMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						type: "say",
						say: "subtask_result",
					}),
				],
			}),
		)

		expect(saveApiMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
					}),
				],
			}),
		)
	})

	describe("reopenParentFromDelegation guard", () => {
		const makeProvider = (parentHistory: Record<string, unknown> | Error) => {
			const getTaskWithId = vi.fn(async () => {
				if (parentHistory instanceof Error) throw parentHistory
				return {
					historyItem: {
						id: "p-guard",
						ts: 1,
						task: "P",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
						...parentHistory,
					},
				}
			})

			return {
				contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
				getTaskWithId,
				emit: vi.fn(),
				log: vi.fn(),
				getCurrentTask: vi.fn(() => ({ taskId: "c-guard" })),
				removeClineFromStack: vi.fn(),
				createTaskWithHistoryItem: vi.fn(),
				updateTaskHistory: vi.fn(),
				taskHistoryStore: legacyHistoryStore,
			} as unknown as ClineProvider
		}

		const reopen = (provider: ClineProvider) =>
			(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
				parentTaskId: "p-guard",
				childTaskId: "c-guard",
				completionResultSummary: "late result",
			})

		it.each([
			["the parent was detached (active)", { status: "active", awaitingChildId: undefined }],
			["the parent delegated to another child", { status: "delegated", awaitingChildId: "c-other" }],
			["the parent completed", { status: "completed", awaitingChildId: "c-guard" }],
		])("returns false and leaves the parent untouched when %s", async (_label, parentHistory) => {
			const provider = makeProvider(parentHistory)

			await expect(reopen(provider)).resolves.toBe(false)

			expect(saveTaskMessages).not.toHaveBeenCalled()
			expect(saveApiMessages).not.toHaveBeenCalled()
			expect((provider as any).updateTaskHistory).not.toHaveBeenCalled()
			expect((provider as any).removeClineFromStack).not.toHaveBeenCalled()
			expect((provider as any).createTaskWithHistoryItem).not.toHaveBeenCalled()
			expect((provider as any).emit).not.toHaveBeenCalled()
		})

		it("returns false when the parent no longer exists", async () => {
			const provider = makeProvider(new Error("Task not found"))

			await expect(reopen(provider)).resolves.toBe(false)
			expect(saveTaskMessages).not.toHaveBeenCalled()
		})

		it("rethrows other lookup errors", async () => {
			const provider = makeProvider(new Error("EACCES"))

			await expect(reopen(provider)).rejects.toThrow("EACCES")
		})

		it("does not duplicate subtask_result or the text fallback on a retried hand-back", async () => {
			const fallback = "Subtask c-guard completed.\n\nResult:\nlate result"
			vi.mocked(readTaskMessages).mockResolvedValue([
				{ type: "say", say: "subtask_result", text: "late result", ts: 1 },
			] as any)
			vi.mocked(readApiMessages).mockResolvedValue([
				{ role: "user", content: [{ type: "text", text: fallback }], ts: 1 },
			] as any)

			const provider = makeProvider({ status: "delegated", awaitingChildId: "c-guard" })

			await expect(reopen(provider)).resolves.toBe(true)

			expect(vi.mocked(saveTaskMessages).mock.calls[0][0].messages).toHaveLength(1)
			expect(vi.mocked(saveApiMessages).mock.calls[0][0].messages).toHaveLength(1)
		})

		it("serializes hand-backs for the same parent so only the first one reopens it", async () => {
			// Both completions read the parent after the previous transition wrote it.
			let parentRecord: Record<string, unknown> = { status: "delegated", awaitingChildId: "c-guard" }
			const provider = makeProvider({})
			;(provider as any).getTaskWithId = vi.fn(async () => ({
				historyItem: {
					id: "p-guard",
					ts: 1,
					task: "P",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
					...parentRecord,
				},
			}))
			;(provider as any).updateTaskHistory = vi.fn(async (item: Record<string, unknown>) => {
				if (item.id === "p-guard") parentRecord = item
				return []
			})

			const results = await Promise.all([reopen(provider), reopen(provider)])

			expect(results).toEqual([true, false])
			expect((provider as any).createTaskWithHistoryItem).toHaveBeenCalledTimes(1)
		})
	})

	describe("parent resume after the hand-back", () => {
		const makeProvider = (resumeAfterDelegation: () => Promise<void>) =>
			({
				contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
				getTaskWithId: vi.fn().mockResolvedValue({
					historyItem: {
						id: "p-r",
						status: "delegated",
						awaitingChildId: "c-r",
						ts: 1,
						task: "P",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
					},
				}),
				emit: vi.fn(),
				log: vi.fn(),
				getCurrentTask: vi.fn(() => ({ taskId: "c-r" })),
				removeClineFromStack: vi.fn(),
				createTaskWithHistoryItem: vi.fn().mockResolvedValue({
					taskId: "p-r",
					overwriteClineMessages: vi.fn(),
					overwriteApiConversationHistory: vi.fn(),
					resumeAfterDelegation: vi.fn(resumeAfterDelegation),
				}),
				updateTaskHistory: vi.fn(),
				taskHistoryStore: legacyHistoryStore,
			}) as unknown as ClineProvider

		const reopen = (provider: ClineProvider) =>
			(ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, {
				parentTaskId: "p-r",
				childTaskId: "c-r",
				completionResultSummary: "done",
			})

		it("does not wait for the parent's task loop to finish", async () => {
			// The parent's loop keeps running (it only ends when the parent finishes).
			const provider = makeProvider(() => new Promise<void>(() => {}))

			await expect(reopen(provider)).resolves.toBe(true)
			expect((provider as any).emit).toHaveBeenCalledWith(BearCodeEventName.TaskDelegationResumed, "p-r", "c-r")
		})

		it("reports a failed parent resume to the user", async () => {
			const vscode = await import("vscode")
			const provider = makeProvider(() => Promise.reject(new Error("resume failed")))

			await expect(reopen(provider)).resolves.toBe(true)
			await vi.waitFor(() => expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("resume failed"))
		})
	})
})

describe("reopenParentFromDelegation across panels", () => {
	const delegatedParent = {
		id: "p1",
		status: "delegated",
		awaitingChildId: "c1",
		childIds: ["c1"],
		ts: 100,
		task: "Parent",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}

	const buildProvider = (overrides: Record<string, unknown> = {}) =>
		({
			contextProxy: { globalStorageUri: { fsPath: "/storage" } },
			log: vi.fn(),
			emit: vi.fn(),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { ...delegatedParent } }),
			getCurrentTask: vi.fn(() => ({ taskId: "c1" })),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue({
				taskId: "p1",
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			}),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			taskHistoryStore: legacyHistoryStore,
			...overrides,
		}) as unknown as ClineProvider

	beforeEach(() => {
		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])
	})

	it("adds the result to the turn's flushed results instead of a second user message", async () => {
		// update_todo_list ran before new_task; its result was flushed before the parent closed.
		vi.mocked(readApiMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Plan it" }], ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tu_todo", name: "update_todo_list", input: {} },
					{ type: "tool_use", id: "tu_task", name: "new_task", input: {} },
				],
				ts: 2,
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tu_todo", content: "Todo list updated" }],
				ts: 3,
			},
		] as any)
		let saved: any[] = []
		vi.mocked(saveApiMessages).mockImplementationOnce(async ({ messages }: any) => {
			saved = messages
		})

		await (ClineProvider.prototype as any).reopenParentFromDelegation.call(buildProvider(), {
			parentTaskId: "p1",
			childTaskId: "c1",
			completionResultSummary: "done",
		})

		expect(saved).toHaveLength(3)
		const results = saved[2].content.map((block: any) => [block.tool_use_id, block.content])
		expect(results).toEqual([
			["tu_todo", "Todo list updated"],
			["tu_task", expect.stringContaining("Subtask c1 completed")],
		])
	})

	it("closes the parent where another panel has it open before writing its history", async () => {
		const order: string[] = []
		const otherPanel = {
			getCurrentTask: () => ({ taskId: "p1" }),
			removeClineFromStack: vi.fn(async () => {
				order.push("close in other panel")
			}),
		}
		vi.mocked(saveTaskMessages).mockImplementationOnce(async () => {
			order.push("save parent messages")
		})
		const instances = (ClineProvider as any).activeInstances as Set<unknown>
		instances.add(otherPanel)

		try {
			const reopened = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(buildProvider(), {
				parentTaskId: "p1",
				childTaskId: "c1",
				completionResultSummary: "done",
			})
			expect(reopened).toBe(true)
		} finally {
			instances.delete(otherPanel)
		}

		expect(otherPanel.removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(order).toEqual(["close in other panel", "save parent messages"])
	})

	it("serializes a hand-back in one panel with a detach in another", async () => {
		let record: Record<string, any> = { ...delegatedParent }
		const store = {
			get: vi.fn(() => ({ ...record })),
			refresh: vi.fn(async () => ({ ...record })),
			atomicReadAndUpdate: vi.fn(async (_id: string, updater: (item: any) => any) => {
				record = updater({ ...record })
				return []
			}),
		}
		let releaseDetachWrite!: () => void
		const detachWriteGate = new Promise<void>((resolve) => {
			releaseDetachWrite = resolve
		})
		store.atomicReadAndUpdate.mockImplementationOnce(async (_id: string, updater: (item: any) => any) => {
			await detachWriteGate
			record = updater({ ...record })
			return []
		})

		// Panel P resumes the parent by hand; panel C finishes the child at the same time.
		const panelP = buildProvider({ taskHistoryStore: store, isViewLaunched: false })
		const panelC = buildProvider({
			getTaskWithId: vi.fn(async () => ({ historyItem: { ...record } })),
		})

		const detach = (ClineProvider.prototype as any).detachDelegatedParent.call(panelP, "p1")
		const handBack = (ClineProvider.prototype as any).reopenParentFromDelegation.call(panelC, {
			parentTaskId: "p1",
			childTaskId: "c1",
			completionResultSummary: "late result",
		})

		releaseDetachWrite()

		await expect(detach).resolves.toEqual({ detached: true, awaitingChildId: "c1" })
		// The hand-back waited for the detach and then saw an active parent.
		await expect(handBack).resolves.toBe(false)
		expect((panelC as any).createTaskWithHistoryItem).not.toHaveBeenCalled()
	})
})
