// npx vitest run core/task/__tests__/Task.delegated-resume.spec.ts

import * as vscode from "vscode"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"

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

/** Minimal `this` for the resume path of a parent that is still waiting for a subtask. */
function makeTaskStub(opts: { status?: "active" | "delegated"; detach?: () => Promise<unknown> }) {
	const provider = {
		detachDelegatedParent: vi.fn(opts.detach ?? (async () => ({ detached: true, awaitingChildId: "child-1" }))),
	}

	const stub: any = {
		taskId: "parent-1",
		instanceId: "inst",
		initialStatus: opts.status,
		providerRef: { deref: () => provider },
		getSavedClineMessages: vi.fn().mockResolvedValue([]),
		overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
		// No API history: resumeTaskFromHistory stops right after the resume ask.
		getSavedApiConversationHistory: vi.fn().mockResolvedValue([]),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		say: vi.fn(),
		abandoned: false,
		abort: false,
	}
	stub.detachFromAwaitedSubtask = (Task.prototype as any).detachFromAwaitedSubtask.bind(stub)

	return { stub, provider }
}

const resume = (stub: unknown) =>
	(Task.prototype as any).resumeTaskFromHistory.call(stub).catch((error: Error) => {
		if (!error.message.includes("No existing API conversation history")) {
			throw error
		}
	})

describe("Resuming a parent that still waits for its subtask", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(vscode.window.showWarningMessage).mockClear()
	})

	it("detaches the parent once the user answers the resume ask", async () => {
		const { stub, provider } = makeTaskStub({ status: "delegated" })

		await resume(stub)

		expect(stub.ask).toHaveBeenCalledWith("resume_task")
		expect(provider.detachDelegatedParent).toHaveBeenCalledWith("parent-1")
		// Later saves write "active", not the stale "delegated".
		expect(stub.initialStatus).toBe("active")
	})

	it("does not touch the history of a parent that is not delegated", async () => {
		const { stub, provider } = makeTaskStub({ status: "active" })

		await resume(stub)

		expect(provider.detachDelegatedParent).not.toHaveBeenCalled()
		expect(stub.initialStatus).toBe("active")
	})

	it("does not detach a parent the user only opened", async () => {
		const { stub, provider } = makeTaskStub({ status: "delegated" })
		// The resume ask is still pending: the user has not resumed the task.
		stub.ask = vi.fn(() => new Promise(() => {}))

		void (Task.prototype as any).resumeTaskFromHistory.call(stub)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(provider.detachDelegatedParent).not.toHaveBeenCalled()
		expect(stub.initialStatus).toBe("delegated")
	})

	it("warns when the awaited subtask is still open in another window", async () => {
		vi.spyOn(ClineProvider, "isTaskOpen").mockReturnValue(true)
		const { stub } = makeTaskStub({ status: "delegated" })

		await resume(stub)

		expect(ClineProvider.isTaskOpen).toHaveBeenCalledWith("child-1")
		expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1)
	})

	it("does not warn when the subtask is not open anywhere", async () => {
		vi.spyOn(ClineProvider, "isTaskOpen").mockReturnValue(false)
		const { stub } = makeTaskStub({ status: "delegated" })

		await resume(stub)

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("keeps resuming when the history update fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		const { stub } = makeTaskStub({
			status: "delegated",
			detach: async () => {
				throw new Error("disk full")
			},
		})

		await resume(stub)

		// The resume continued past the detach step to the history checks.
		expect(stub.getSavedApiConversationHistory).toHaveBeenCalled()
		expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Failed to detach parent-1"))
	})
})
