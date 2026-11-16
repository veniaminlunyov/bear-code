// npx vitest run core/task/__tests__/Task.delegation-abort.spec.ts

import { Task } from "../Task"
import { presentAssistantMessage } from "../../assistant-message/presentAssistantMessage"

vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showErrorMessage: vi.fn(),
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

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue("<environment_details></environment_details>"),
}))

/** Minimal `this` for Task.prototype.resumeAfterDelegation. */
function makeTaskStub(loop: () => Promise<void>) {
	return {
		taskId: "parent-1",
		instanceId: "inst",
		apiConversationHistory: [{ role: "user", content: [{ type: "text", text: "tool result" }] }],
		emit: vi.fn(),
		saveApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		initiateTaskLoop: vi.fn(loop),
		abandoned: false,
		abortReason: undefined as string | undefined,
	}
}

describe("Task abort handling around delegation", () => {
	it("presentAssistantMessage returns instead of throwing for an aborted task", async () => {
		const task = { taskId: "t", instanceId: "i", abort: true, presentAssistantMessageLocked: false } as any

		await expect(presentAssistantMessage(task)).resolves.toBeUndefined()
		expect(task.presentAssistantMessageLocked).toBe(false)
	})

	it("resumeAfterDelegation swallows the loop rejection of an abandoned task", async () => {
		const stub = makeTaskStub(async () => {
			// The resumed parent delegates again: the instance is closed mid-loop.
			stub.abandoned = true
			throw new Error("aborted")
		})

		await expect((Task.prototype as any).resumeAfterDelegation.call(stub)).resolves.toBeUndefined()
		expect(stub.initiateTaskLoop).toHaveBeenCalledWith([])
	})

	it("resumeAfterDelegation still surfaces unexpected loop errors", async () => {
		const stub = makeTaskStub(async () => {
			throw new Error("boom")
		})

		await expect((Task.prototype as any).resumeAfterDelegation.call(stub)).rejects.toThrow("boom")
	})
})
