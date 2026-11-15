import { type CustomToolDefinition } from "@bear-code/types"

export type StoredCustomTool = CustomToolDefinition & { source?: string }

export interface LoadResult {
	loaded: string[]
	failed: Array<{ file: string; error: string }>
}
