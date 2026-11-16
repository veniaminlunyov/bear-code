import { historyItemSchema, pendingTaskActionSchema } from "../history.js"

const baseItem = {
	id: "task-1",
	number: 1,
	ts: 1,
	task: "Task",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
}

describe("pendingTaskActionSchema", () => {
	it("accepts a create_subtask action", () => {
		const action = {
			kind: "create_subtask",
			actionId: "call_1",
			approvalText: '{"tool":"newTask"}',
			mode: "code",
			message: "Do it",
			todos: [{ id: "1", content: "step", status: "pending" }],
		}

		expect(pendingTaskActionSchema.parse(action)).toEqual(action)
	})

	it("accepts a finish_subtask action", () => {
		const action = {
			kind: "finish_subtask",
			actionId: "call_2",
			approvalText: '{"tool":"finishTask"}',
			parentTaskId: "parent-1",
			result: "Done",
		}

		expect(pendingTaskActionSchema.parse(action)).toEqual(action)
	})

	it("rejects an unknown kind or a missing field", () => {
		expect(pendingTaskActionSchema.safeParse({ kind: "other", actionId: "x" }).success).toBe(false)
		expect(
			pendingTaskActionSchema.safeParse({ kind: "finish_subtask", actionId: "x", approvalText: "{}", result: "" })
				.success,
		).toBe(false)
	})
})

describe("historyItemSchema pendingAction", () => {
	it("keeps history items without a pending action valid", () => {
		expect(historyItemSchema.safeParse(baseItem).success).toBe(true)
	})

	it("round-trips a pending action", () => {
		const pendingAction = {
			kind: "finish_subtask" as const,
			actionId: "call_2",
			approvalText: '{"tool":"finishTask"}',
			parentTaskId: "parent-1",
			result: "Done",
		}

		expect(historyItemSchema.parse({ ...baseItem, pendingAction }).pendingAction).toEqual(pendingAction)
	})
})
