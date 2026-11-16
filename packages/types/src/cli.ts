import { z } from "zod"

import { bearCodeSettingsSchema } from "./global-settings.js"

/**
 * Bear CLI stdin commands
 */

export const bearCliCommandNames = ["start", "message", "cancel", "ping", "shutdown"] as const

export const bearCliCommandNameSchema = z.enum(bearCliCommandNames)

export type BearCliCommandName = z.infer<typeof bearCliCommandNameSchema>

export const bearCliCommandBaseSchema = z.object({
	command: bearCliCommandNameSchema,
	requestId: z.string().min(1),
})

export type BearCliCommandBase = z.infer<typeof bearCliCommandBaseSchema>

const bearCliSessionIdSchema = z
	.string()
	.trim()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

export const bearCliStartCommandSchema = bearCliCommandBaseSchema.extend({
	command: z.literal("start"),
	prompt: z.string(),
	taskId: bearCliSessionIdSchema.optional(),
	images: z.array(z.string()).optional(),
	configuration: bearCodeSettingsSchema.optional(),
})

export type BearCliStartCommand = z.infer<typeof bearCliStartCommandSchema>

export const bearCliMessageCommandSchema = bearCliCommandBaseSchema.extend({
	command: z.literal("message"),
	prompt: z.string(),
	images: z.array(z.string()).optional(),
})

export type BearCliMessageCommand = z.infer<typeof bearCliMessageCommandSchema>

export const bearCliCancelCommandSchema = bearCliCommandBaseSchema.extend({
	command: z.literal("cancel"),
})

export type BearCliCancelCommand = z.infer<typeof bearCliCancelCommandSchema>

export const bearCliPingCommandSchema = bearCliCommandBaseSchema.extend({
	command: z.literal("ping"),
})

export type BearCliPingCommand = z.infer<typeof bearCliPingCommandSchema>

export const bearCliShutdownCommandSchema = bearCliCommandBaseSchema.extend({
	command: z.literal("shutdown"),
})

export type BearCliShutdownCommand = z.infer<typeof bearCliShutdownCommandSchema>

export const bearCliInputCommandSchema = z.discriminatedUnion("command", [
	bearCliStartCommandSchema,
	bearCliMessageCommandSchema,
	bearCliCancelCommandSchema,
	bearCliPingCommandSchema,
	bearCliShutdownCommandSchema,
])

export type BearCliInputCommand = z.infer<typeof bearCliInputCommandSchema>

/**
 * Bear CLI stream-json output
 */

export const bearCliOutputFormats = ["text", "json", "stream-json"] as const

export const bearCliOutputFormatSchema = z.enum(bearCliOutputFormats)

export type BearCliOutputFormat = z.infer<typeof bearCliOutputFormatSchema>

export const bearCliEventTypes = [
	"system",
	"control",
	"queue",
	"assistant",
	"user",
	"tool_use",
	"tool_result",
	"thinking",
	"error",
	"result",
] as const

export const bearCliEventTypeSchema = z.enum(bearCliEventTypes)

export type BearCliEventType = z.infer<typeof bearCliEventTypeSchema>

export const bearCliControlSubtypes = ["ack", "done", "error"] as const

export const bearCliControlSubtypeSchema = z.enum(bearCliControlSubtypes)

export type BearCliControlSubtype = z.infer<typeof bearCliControlSubtypeSchema>

export const bearCliQueueItemSchema = z.object({
	id: z.string().min(1),
	text: z.string().optional(),
	imageCount: z.number().optional(),
	timestamp: z.number().optional(),
})

export type BearCliQueueItem = z.infer<typeof bearCliQueueItemSchema>

export const bearCliToolUseSchema = z.object({
	name: z.string(),
	input: z.record(z.string(), z.unknown()).optional(),
})

export type BearCliToolUse = z.infer<typeof bearCliToolUseSchema>

export const bearCliToolResultSchema = z.object({
	name: z.string(),
	output: z.string().optional(),
	error: z.string().optional(),
	exitCode: z.number().optional(),
})

export type BearCliToolResult = z.infer<typeof bearCliToolResultSchema>

export const bearCliCostSchema = z.object({
	totalCost: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
})

export type BearCliCost = z.infer<typeof bearCliCostSchema>

export const bearCliStreamEventSchema = z
	.object({
		type: bearCliEventTypeSchema.optional(),
		subtype: z.string().optional(),
		requestId: z.string().optional(),
		command: bearCliCommandNameSchema.optional(),
		taskId: z.string().optional(),
		code: z.string().optional(),
		content: z.string().optional(),
		success: z.boolean().optional(),
		id: z.number().optional(),
		done: z.boolean().optional(),
		queueDepth: z.number().optional(),
		queue: z.array(bearCliQueueItemSchema).optional(),
		schemaVersion: z.number().optional(),
		protocol: z.string().optional(),
		capabilities: z.array(z.string()).optional(),
		tool_use: bearCliToolUseSchema.optional(),
		tool_result: bearCliToolResultSchema.optional(),
		cost: bearCliCostSchema.optional(),
	})
	.passthrough()

export type BearCliStreamEvent = z.infer<typeof bearCliStreamEventSchema>

export const bearCliControlEventSchema = bearCliStreamEventSchema.extend({
	type: z.literal("control"),
	subtype: bearCliControlSubtypeSchema,
	requestId: z.string().min(1),
})

export type BearCliControlEvent = z.infer<typeof bearCliControlEventSchema>

export const bearCliFinalOutputSchema = z.object({
	type: z.literal("result"),
	success: z.boolean(),
	content: z.string().optional(),
	cost: bearCliCostSchema.optional(),
	events: z.array(bearCliStreamEventSchema),
})

export type BearCliFinalOutput = z.infer<typeof bearCliFinalOutputSchema>
