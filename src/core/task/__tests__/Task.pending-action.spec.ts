// npx vitest run core/task/__tests__/Task.pending-action.spec.ts

import type { PendingTaskAction } from "@bear-code/types"
import { BearCodeEventName } from "@bear-code/types"

import { Task } from "../Task"
import { PendingActionSettledError } from "../../webview/ClineProvider"

vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(() => ({ get: (_k: string, d: unknown) => d })),
		workspaceFolders: [],
		onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: { language: "en" },
	Uri: { file: (p: string) => ({ fsPath: p }) },
	EventEmitter: vi.fn(),
	RelativePattern: vi.fn(),
}))

const createAction: PendingTaskAction = {
	kind: "create_subtask",
	actionId: "call_new",
	approvalText: '{"tool":"newTask","mode":"Code","content":"Do it","todos":[]}',
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

/** An assistant turn that called update_todo_list and then the tool the approval belongs to. */
const turnWith = (actionId: string, toolName: string) => [
	{ role: "user", content: [{ type: "text", text: "Start" }] },
	{
		role: "assistant",
		content: [
			{ type: "tool_use", id: "call_todo", name: "update_todo_list", input: {} },
			{ type: "tool_use", id: actionId, name: toolName, input: {} },
		],
	},
]

function makeTask(action: PendingTaskAction | undefined, apiHistory: any[]) {
	const provider = {
		clearPendingTaskAction: vi.fn().mockResolvedValue(true),
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
		reopenParentFromDelegation: vi.fn().mockResolvedValue(true),
		getCurrentTask: vi.fn(),
		removeClineFromStack: vi.fn(),
	}
	const task = Object.create(Task.prototype) as any
	Object.assign(task, {
		taskId: "task-1",
		instanceId: "inst",
		abort: false,
		abandoned: false,
		pendingAction: action,
		apiConversationHistory: apiHistory,
		userMessageContent: [],
		providerRef: { deref: () => provider },
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
		emit: vi.fn(),
		emitFinalTokenUsageUpdate: vi.fn(),
		getTokenUsage: vi.fn(() => ({})),
		toolUsage: {},
		initiateTaskLoop: vi.fn().mockResolvedValue(undefined),
		overwriteApiConversationHistory: vi.fn(async (history: any[]) => {
			task.apiConversationHistory = history
		}),
	})
	return { task, provider }
}

const resumeAction = (task: any) => task.resumePendingTaskAction(task.pendingAction)

describe("Task pending subtask approvals", () => {
	describe("asking again", () => {
		it("asks by hand only, never through auto-approval", async () => {
			const { task } = makeTask(createAction, turnWith("call_new", "new_task"))

			await resumeAction(task)

			expect(task.ask).toHaveBeenCalledWith("tool", createAction.approvalText, false, undefined, false, {
				manualApprovalOnly: true,
			})
		})

		it("delegates on approval, settling this approval and passing the turn's other results along", async () => {
			const { task, provider } = makeTask(createAction, turnWith("call_new", "new_task"))

			await resumeAction(task)

			expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith({
				parentTaskId: "task-1",
				message: "Do it",
				initialTodos: [],
				mode: "code",
				pendingActionId: "call_new",
			})
			// The delegation flushes these; update_todo_list never got its result.
			expect(task.userMessageContent).toEqual([
				expect.objectContaining({ type: "tool_result", tool_use_id: "call_todo" }),
			])
			expect(task.initiateTaskLoop).not.toHaveBeenCalled()
		})

		it("answers the tool call with a denial and continues when rejected", async () => {
			const { task, provider } = makeTask(createAction, turnWith("call_new", "new_task"))
			task.ask.mockResolvedValueOnce({ response: "messageResponse", text: "not now" })

			await resumeAction(task)

			expect(provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
			expect(task.say).toHaveBeenCalledWith("user_feedback", "not now", undefined)
			expect(provider.clearPendingTaskAction).toHaveBeenCalledWith("task-1", "call_new")
			const [content] = task.initiateTaskLoop.mock.calls[0]
			expect(content).toEqual([
				expect.objectContaining({ tool_use_id: "call_todo" }),
				expect.objectContaining({
					type: "tool_result",
					tool_use_id: "call_new",
					content: expect.stringContaining("not now"),
				}),
			])
		})

		it("reports a delegation that fails before anything changed once, instead of on every open", async () => {
			const { task, provider } = makeTask(createAction, turnWith("call_new", "new_task"))
			provider.delegateParentAndOpenChild.mockRejectedValueOnce(new Error("Invalid mode"))

			await resumeAction(task)

			expect(provider.clearPendingTaskAction).toHaveBeenCalledWith("task-1", "call_new")
			expect(task.pendingTaskAction).toBeUndefined()
			const [content] = task.initiateTaskLoop.mock.calls[0]
			expect(content.at(-1)).toMatchObject({
				tool_use_id: "call_new",
				content: expect.stringContaining("Invalid mode"),
			})
		})

		it("stops when the delegation failed after closing this task (the provider reopened the parent)", async () => {
			const { task, provider } = makeTask(createAction, turnWith("call_new", "new_task"))
			provider.delegateParentAndOpenChild.mockImplementationOnce(async () => {
				task.abort = true
				throw new Error("child could not be created")
			})

			await resumeAction(task)

			expect(task.initiateTaskLoop).not.toHaveBeenCalled()
		})

		it("closes this instance when another panel already answered the approval", async () => {
			const { task, provider } = makeTask(createAction, turnWith("call_new", "new_task"))
			provider.getCurrentTask.mockReturnValue(task)
			provider.delegateParentAndOpenChild.mockRejectedValueOnce(
				new PendingActionSettledError("task-1", "call_new"),
			)

			await resumeAction(task)

			expect(provider.removeClineFromStack).toHaveBeenCalledTimes(1)
			expect(task.initiateTaskLoop).not.toHaveBeenCalled()
		})

		it("hands the result back on an approved finish", async () => {
			const { task, provider } = makeTask(finishAction, turnWith("call_finish", "attempt_completion"))

			await resumeAction(task)

			expect(provider.reopenParentFromDelegation).toHaveBeenCalledWith({
				parentTaskId: "parent-1",
				childTaskId: "task-1",
				completionResultSummary: "Done",
				pendingActionId: "call_finish",
			})
			expect(task.emit).toHaveBeenCalledWith(BearCodeEventName.TaskCompleted, "task-1", {}, {})
		})

		it("finishes as a standalone task when the parent no longer waits (deleted or resumed)", async () => {
			const { task, provider } = makeTask(finishAction, turnWith("call_finish", "attempt_completion"))
			provider.reopenParentFromDelegation.mockResolvedValueOnce(false)

			await resumeAction(task)

			expect(provider.clearPendingTaskAction).toHaveBeenCalledWith("task-1", "call_finish")
			expect(task.ask).toHaveBeenLastCalledWith("completion_result", "", false)
			expect(task.emit).toHaveBeenCalledWith(BearCodeEventName.TaskCompleted, "task-1", {}, {})
		})
	})

	describe("locating the approval's tool call", () => {
		it("treats an approval whose tool_result is already saved as stale", () => {
			const history = [
				...turnWith("call_new", "new_task"),
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_new", content: "Denied" }] },
			]
			const { task } = makeTask(createAction, history)

			expect(task.locatePendingActionToolCall("call_new")).toBeUndefined()
		})

		it("treats an approval whose tool call is gone (messages deleted, checkpoint restored) as stale", () => {
			const { task } = makeTask(createAction, [{ role: "user", content: [{ type: "text", text: "Start" }] }])

			expect(task.locatePendingActionToolCall("call_new")).toBeUndefined()
		})

		it("keeps the results already saved for the same turn", () => {
			const history = [
				...turnWith("call_new", "new_task"),
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_todo", content: "ok" }] },
			]
			const { task } = makeTask(createAction, history)

			const location = task.locatePendingActionToolCall("call_new")

			expect(location.historyBeforeResults).toHaveLength(2)
			expect(location.existingResults).toEqual([{ type: "tool_result", tool_use_id: "call_todo", content: "ok" }])
			expect(location.interruptedResults).toEqual([])
		})
	})

	describe("settling by tool_result", () => {
		it("clears the approval once a tool_result for it is saved", async () => {
			const { task, provider } = makeTask(createAction, [])

			await task.settlePendingActionByToolResults([
				{ type: "tool_result", tool_use_id: "call_new", content: "x" },
			])

			expect(provider.clearPendingTaskAction).toHaveBeenCalledWith("task-1", "call_new")
			expect(task.pendingTaskAction).toBeUndefined()
		})

		it("keeps the approval for results of other tool calls", async () => {
			const { task, provider } = makeTask(createAction, [])

			await task.settlePendingActionByToolResults([
				{ type: "tool_result", tool_use_id: "call_todo", content: "x" },
			])

			expect(provider.clearPendingTaskAction).not.toHaveBeenCalled()
			expect(task.pendingTaskAction).toEqual(createAction)
		})
	})

	describe("resumeTaskFromHistory", () => {
		function makeResumingTask(action: PendingTaskAction, apiHistory: any[]) {
			const { task, provider } = makeTask(action, apiHistory)
			const savedMessages = [
				{ ts: 1, type: "say", say: "text", text: "Start" },
				{ ts: 2, type: "ask", ask: "tool", text: action.approvalText },
			]
			Object.assign(task, {
				getSavedClineMessages: vi.fn().mockResolvedValue(savedMessages),
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				getSavedApiConversationHistory: vi.fn().mockResolvedValue(apiHistory),
			})
			return { task, provider }
		}

		it("drops the old approval row and asks it again after a reload", async () => {
			const { task, provider } = makeResumingTask(createAction, turnWith("call_new", "new_task"))

			await task.resumeTaskFromHistory()

			// The row without buttons is gone; the new ask replaces it.
			expect(task.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 1, type: "say", say: "text", text: "Start" },
			])
			expect(task.ask).toHaveBeenCalledWith("tool", createAction.approvalText, false, undefined, false, {
				manualApprovalOnly: true,
			})
			expect(provider.delegateParentAndOpenChild).toHaveBeenCalledTimes(1)
		})

		it("clears a stale approval and resumes normally", async () => {
			const history = [
				...turnWith("call_new", "new_task"),
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_new", content: "Denied" }] },
			]
			const { task, provider } = makeResumingTask(createAction, history)
			task.ask.mockResolvedValue({ response: "yesButtonClicked" })

			await task.resumeTaskFromHistory()

			expect(provider.clearPendingTaskAction).toHaveBeenCalledWith("task-1", "call_new")
			expect(provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
			// The normal resume prompt instead of the approval.
			expect(task.ask).toHaveBeenCalledWith("resume_task")
		})
	})
})
