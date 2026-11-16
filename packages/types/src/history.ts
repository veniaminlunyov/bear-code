import { z } from "zod"

import { todoItemSchema } from "./todo.js"

/**
 * A subtask approval the task is waiting for, saved so it can be asked again
 * after a reload or after the user leaves the task. `actionId` is the tool call
 * id of the new_task / attempt_completion call it belongs to; the action is
 * settled by a tool_result for that id or by the delegation write itself.
 */
export const pendingTaskActionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("create_subtask"),
		actionId: z.string(),
		approvalText: z.string(),
		mode: z.string(),
		message: z.string(),
		todos: z.array(todoItemSchema),
	}),
	z.object({
		kind: z.literal("finish_subtask"),
		actionId: z.string(),
		approvalText: z.string(),
		parentTaskId: z.string(),
		result: z.string(),
	}),
])

export type PendingTaskAction = z.infer<typeof pendingTaskActionSchema>

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: z.enum(["active", "completed", "delegated"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
	pendingAction: pendingTaskActionSchema.optional(), // Subtask approval waiting for the user
})

export type HistoryItem = z.infer<typeof historyItemSchema>
