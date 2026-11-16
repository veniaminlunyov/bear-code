// npx vitest run core/task/__tests__/providerHandoff.spec.ts

import type { ProviderSettings } from "@bear-code/types"

import { selectHandoffExecutionContext, type TaskExecutionContext } from "../providerHandoff"

const parent: TaskExecutionContext = {
	mode: "orchestrator",
	apiConfigName: "parent-profile",
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "parent-model" } as ProviderSettings,
}

const saved = {
	name: "code-profile",
	apiConfiguration: { apiProvider: "openai", openAiModelId: "code-model" } as ProviderSettings,
}

describe("selectHandoffExecutionContext", () => {
	it("uses the profile saved for the child's mode when the mode changes", () => {
		const context = selectHandoffExecutionContext(parent, "code", false, saved)

		expect(context).toEqual({
			mode: "code",
			apiConfigName: "code-profile",
			apiConfiguration: saved.apiConfiguration,
		})
		expect(context.apiConfiguration).not.toBe(saved.apiConfiguration)
	})

	it.each([
		["the mode is unchanged", "orchestrator", false, saved],
		["profiles are locked across modes", "code", true, saved],
		["the mode has no saved profile", "code", false, undefined],
		["the saved profile is not configured", "code", false, { name: "empty", apiConfiguration: {} }],
	])("inherits the parent's profile when %s", (_label, mode, locked, savedProfile) => {
		const context = selectHandoffExecutionContext(parent, mode as string, locked as boolean, savedProfile as any)

		expect(context).toEqual({
			mode,
			apiConfigName: "parent-profile",
			apiConfiguration: parent.apiConfiguration,
		})
		expect(context.apiConfiguration).not.toBe(parent.apiConfiguration)
	})
})
