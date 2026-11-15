import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { modelInfoSchema } from "./model.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * BearCodeEventName
 */

export enum BearCodeEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Query Responses
	CommandsResponse = "commandsResponse",
	ModesResponse = "modesResponse",
	ModelsResponse = "modelsResponse",
}

/**
 * BearCodeEvents
 */

export const bearCodeEventsSchema = z.object({
	[BearCodeEventName.TaskCreated]: z.tuple([z.string()]),

	[BearCodeEventName.TaskStarted]: z.tuple([z.string()]),
	[BearCodeEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[BearCodeEventName.TaskAborted]: z.tuple([z.string()]),
	[BearCodeEventName.TaskFocused]: z.tuple([z.string()]),
	[BearCodeEventName.TaskUnfocused]: z.tuple([z.string()]),
	[BearCodeEventName.TaskActive]: z.tuple([z.string()]),
	[BearCodeEventName.TaskInteractive]: z.tuple([z.string()]),
	[BearCodeEventName.TaskResumable]: z.tuple([z.string()]),
	[BearCodeEventName.TaskIdle]: z.tuple([z.string()]),

	[BearCodeEventName.TaskPaused]: z.tuple([z.string()]),
	[BearCodeEventName.TaskUnpaused]: z.tuple([z.string()]),
	[BearCodeEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[BearCodeEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[BearCodeEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[BearCodeEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[BearCodeEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[BearCodeEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[BearCodeEventName.TaskAskResponded]: z.tuple([z.string()]),
	[BearCodeEventName.TaskUserMessage]: z.tuple([z.string()]),
	[BearCodeEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[BearCodeEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[BearCodeEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[BearCodeEventName.ModeChanged]: z.tuple([z.string()]),
	[BearCodeEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),

	[BearCodeEventName.CommandsResponse]: z.tuple([
		z.array(
			z.object({
				name: z.string(),
				source: z.enum(["global", "project", "built-in"]),
				filePath: z.string().optional(),
				description: z.string().optional(),
				argumentHint: z.string().optional(),
			}),
		),
	]),
	[BearCodeEventName.ModesResponse]: z.tuple([z.array(z.object({ slug: z.string(), name: z.string() }))]),
	[BearCodeEventName.ModelsResponse]: z.tuple([z.record(z.string(), modelInfoSchema)]),
})

export type BearCodeEvents = z.infer<typeof bearCodeEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(BearCodeEventName.TaskCreated),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(BearCodeEventName.TaskStarted),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskCompleted),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskAborted),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskFocused),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskUnfocused),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskActive),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskInteractive),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskResumable),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskIdle),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(BearCodeEventName.TaskPaused),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskUnpaused),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskSpawned),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskDelegated),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskDelegationCompleted),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskDelegationResumed),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(BearCodeEventName.Message),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskModeSwitched),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskAskResponded),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.QueuedMessagesUpdated),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(BearCodeEventName.TaskToolFailed),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.TaskTokenUsageUpdated),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Query Responses
	z.object({
		eventName: z.literal(BearCodeEventName.CommandsResponse),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.CommandsResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.ModesResponse),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.ModesResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(BearCodeEventName.ModelsResponse),
		payload: bearCodeEventsSchema.shape[BearCodeEventName.ModelsResponse],
		taskId: z.number().optional(),
	}),
])

export type TaskEvent = z.infer<typeof taskEventSchema>
