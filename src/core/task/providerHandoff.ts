import type { ProviderSettings } from "@bear-code/types"

/**
 * The mode and provider profile a task runs with. A delegated child gets this
 * from its parent instead of reading the provider's shared (focused) state.
 */
export type TaskExecutionContext = {
	mode: string
	apiConfigName: string | undefined
	apiConfiguration: ProviderSettings
}

export type SavedModeProfile = {
	name?: string
	apiConfiguration: ProviderSettings
}

/**
 * Pick the execution context for a child delegated by `parent` into
 * `requestedMode`. The child switches to the profile saved for its mode only
 * when the mode actually changes, profiles are not locked across modes, and
 * the saved profile is configured; otherwise it inherits the parent's profile.
 * The configuration is always a copy, so the child never shares an object
 * with the parent or the settings store.
 */
export function selectHandoffExecutionContext(
	parent: TaskExecutionContext,
	requestedMode: string,
	lockApiConfigAcrossModes: boolean,
	savedModeProfile?: SavedModeProfile,
): TaskExecutionContext {
	if (requestedMode !== parent.mode && !lockApiConfigAcrossModes && savedModeProfile?.apiConfiguration.apiProvider) {
		return {
			mode: requestedMode,
			apiConfigName: savedModeProfile.name,
			apiConfiguration: structuredClone(savedModeProfile.apiConfiguration),
		}
	}

	return {
		mode: requestedMode,
		apiConfigName: parent.apiConfigName,
		apiConfiguration: structuredClone(parent.apiConfiguration),
	}
}
