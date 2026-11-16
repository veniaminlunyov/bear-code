import { Task, queuedResponseForAsk } from "../Task"

// Keep this test focused: if a queued message arrives while Task.ask() is blocked,
// it should be consumed and used to fulfill the ask.

describe("Task.ask queued message drain", () => {
	it("consumes queued message while blocked on followup ask", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined

		// Message queue service exists in constructor; for unit test we can attach a real one.
		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()

		// Minimal stubs used by ask()
		;(task as any).addToClineMessages = vi.fn(async () => {})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})
		;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }

		const askPromise = task.ask("followup", "Q?", false)

		// Simulate webview queuing the user's selection text while the ask is pending.
		;(task as any).messageQueueService.addMessage("picked answer")

		const result = await askPromise
		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("picked answer")
	})

	it("does not consume queued messages for command_output asks", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined

		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()
		;(task as any).addToClineMessages = vi.fn(async () => {})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})
		;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }

		const askPromise = task.ask("command_output", "command is still running...", false)
		;(task as any).messageQueueService.addMessage("1+1=?")

		setTimeout(() => {
			task.approveAsk()
		}, 0)

		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBeUndefined()
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("1+1=?")
	})

	const makeTask = async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined

		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()
		;(task as any).addToClineMessages = vi.fn(async () => {})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})
		;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }
		return task
	}

	it.each(["newTask", "finishTask"])(
		"rejects a %s approval with the queued text as feedback instead of approving it",
		async (tool) => {
			const task = await makeTask()
			// Queued before the ask appears (typed while the model was still streaming).
			;(task as any).messageQueueService.addMessage("wait, not yet")

			const result = await task.ask("tool", JSON.stringify({ tool, mode: "code", content: "x" }), false)

			expect(result.response).toBe("messageResponse")
			expect(result.text).toBe("wait, not yet")
		},
	)

	it("still approves other tool asks with the queued text as feedback", async () => {
		const task = await makeTask()
		;(task as any).messageQueueService.addMessage("looks good")

		const result = await task.ask("tool", JSON.stringify({ tool: "editedExistingFile", path: "a.ts" }), false)

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBe("looks good")
	})
})

describe("Task.ask manualApprovalOnly", () => {
	it("waits for the user even when subtasks are auto-approved", async () => {
		const task = Object.create(Task.prototype) as Task
		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		Object.assign(task as any, {
			abort: false,
			clineMessages: [],
			messageQueueService: new MessageQueueService(),
			addToClineMessages: vi.fn(async () => {}),
			saveClineMessages: vi.fn(async () => {}),
			updateClineMessage: vi.fn(async () => {}),
			cancelAutoApprovalTimeout: vi.fn(() => {}),
			emit: vi.fn(),
			providerRef: {
				deref: () => ({
					getState: async () => ({ autoApprovalEnabled: true, alwaysAllowSubtasks: true }),
					postMessageToWebview: vi.fn(),
				}),
			},
		})
		const newTask = JSON.stringify({ tool: "newTask", mode: "Code", content: "x" })

		// Without the option the subtask is auto-approved.
		await expect(task.ask("tool", newTask, false)).resolves.toMatchObject({ response: "yesButtonClicked" })

		// With it the ask stays pending until the user answers.
		let settled = false
		const pending = task.ask("tool", newTask, false, undefined, false, { manualApprovalOnly: true }).then((r) => {
			settled = true
			return r
		})
		await new Promise((resolve) => setTimeout(resolve, 250))
		expect(settled).toBe(false)

		task.denyAsk()
		await expect(pending).resolves.toMatchObject({ response: "noButtonClicked" })
	})
})

describe("queuedResponseForAsk", () => {
	it.each([
		["tool", JSON.stringify({ tool: "newTask" }), "messageResponse"],
		["tool", JSON.stringify({ tool: "finishTask" }), "messageResponse"],
		["tool", JSON.stringify({ tool: "readFile" }), "yesButtonClicked"],
		["tool", "not json", "yesButtonClicked"],
		["command", "ls", "yesButtonClicked"],
		["use_mcp_server", "{}", "yesButtonClicked"],
		["followup", "Q?", "messageResponse"],
		["completion_result", "", "messageResponse"],
	] as const)("%s %s → %s", (type, text, expected) => {
		expect(queuedResponseForAsk(type, text)).toBe(expected)
	})
})
