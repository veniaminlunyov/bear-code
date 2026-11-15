import { DEFAULT_MODES, type ModeConfig } from "@bear-code/types"

/**
 * Slugs of the built-in modes whose display name and description are
 * translatable. Custom modes (and user overrides of built-in modes) keep
 * whatever name/description the user configured.
 */
export const BUILTIN_MODE_SLUGS = DEFAULT_MODES.map((mode) => mode.slug)

const BUILTIN_MODE_SLUG_SET = new Set<string>(BUILTIN_MODE_SLUGS)

/**
 * Slugs of the project modes that ship with BearCode (defined in `.bearmodes`)
 * and whose display name and description are translatable.
 *
 * These modes are not part of `DEFAULT_MODES` because they are project-level
 * custom modes, but they are bundled with the extension, so we still want to
 * show localized names/descriptions for them. Translations live under the
 * `prompts:customModes.<slug>.name` / `prompts:customModes.<slug>.description`
 * keys.
 */
export const TRANSLATABLE_CUSTOM_MODE_SLUGS = [
	"translate",
	"issue-fixer",
	"pr-fixer",
	"merge-resolver",
	"docs-extractor",
	"issue-investigator",
	"issue-writer",
] as const

const TRANSLATABLE_CUSTOM_MODE_SLUG_SET = new Set<string>(TRANSLATABLE_CUSTOM_MODE_SLUGS)

/**
 * Returns true when the given slug belongs to a built-in mode.
 */
export function isBuiltinModeSlug(slug: string): boolean {
	return BUILTIN_MODE_SLUG_SET.has(slug)
}

/**
 * Returns true when the given slug belongs to a bundled project mode that has
 * translations available.
 */
export function isTranslatableCustomModeSlug(slug: string): boolean {
	return TRANSLATABLE_CUSTOM_MODE_SLUG_SET.has(slug)
}

/**
 * Returns true when the given slug can be localized (either a built-in mode or
 * a bundled project mode).
 */
export function isTranslatableModeSlug(slug: string): boolean {
	return isBuiltinModeSlug(slug) || isTranslatableCustomModeSlug(slug)
}

type TranslateFn = (key: string, options?: Record<string, any>) => string

/**
 * Builds the i18n key for a mode field, picking the right namespace depending
 * on whether the mode is built-in or a bundled project mode.
 */
function getModeTranslationKey(slug: string, field: "name" | "description"): string {
	const namespace = isBuiltinModeSlug(slug) ? "builtinModes" : "customModes"
	return `prompts:${namespace}.${slug}.${field}`
}

/**
 * Localizes the display name of a mode.
 *
 * For built-in modes we look up `prompts:builtinModes.<slug>.name`, for bundled
 * project modes `prompts:customModes.<slug>.name`. If the translation is
 * missing (e.g. a locale that has not been updated yet) we fall back to the
 * original English name from the mode config. Other custom modes are returned
 * unchanged.
 */
export function getLocalizedModeName(mode: Pick<ModeConfig, "slug" | "name">, t: TranslateFn): string {
	if (!isTranslatableModeSlug(mode.slug)) {
		return mode.name
	}

	const key = getModeTranslationKey(mode.slug, "name")
	const translated = t(key)
	// i18next returns the key itself when the translation is missing.
	return translated === key ? mode.name : translated
}

/**
 * Localizes the short description of a mode.
 *
 * For built-in modes we look up `prompts:builtinModes.<slug>.description`, for
 * bundled project modes `prompts:customModes.<slug>.description`. If the
 * translation is missing we fall back to the original description from the mode
 * config. Other custom modes are returned unchanged.
 */
export function getLocalizedModeDescription(
	mode: Pick<ModeConfig, "slug" | "description">,
	t: TranslateFn,
): string | undefined {
	if (!isTranslatableModeSlug(mode.slug)) {
		return mode.description
	}

	const key = getModeTranslationKey(mode.slug, "description")
	const translated = t(key)
	return translated === key ? mode.description : translated
}

/**
 * Resolves the description that should be displayed for a mode, taking user
 * overrides into account.
 *
 * Built-in modes are seeded with `defaultPrompts`, which contains the original
 * English descriptions. Such "overrides" are indistinguishable from a real user
 * edit, so we treat any override that matches the untranslated default as "not
 * customized" and keep the localized description instead. The same applies to
 * bundled project modes, whose `.bearmodes` description is the untranslated
 * default. Other custom modes and genuine user edits are returned as-is.
 */
export function resolveModeDescription(
	mode: Pick<ModeConfig, "slug" | "description">,
	override: string | undefined,
	t: TranslateFn,
): string | undefined {
	const localized = getLocalizedModeDescription(mode, t)

	if (override === undefined || override === "") {
		return localized
	}

	if (!isTranslatableModeSlug(mode.slug)) {
		return override
	}

	// Ignore overrides that merely repeat the untranslated default description.
	// For built-in modes the default lives in DEFAULT_MODES; for bundled project
	// modes it is the description from `.bearmodes`, which is passed in as
	// `mode.description`.
	const defaultDescription = isBuiltinModeSlug(mode.slug)
		? DEFAULT_MODES.find((defaultMode) => defaultMode.slug === mode.slug)?.description
		: mode.description
	return override === defaultDescription ? localized : override
}

/**
 * Returns a copy of the given mode with its name and description localized.
 * All other fields are preserved as-is.
 */
export function localizeMode<T extends Pick<ModeConfig, "slug" | "name" | "description">>(mode: T, t: TranslateFn): T {
	return {
		...mode,
		name: getLocalizedModeName(mode, t),
		description: getLocalizedModeDescription(mode, t),
	}
}

/**
 * Maps a list of modes, localizing the name and description of built-in modes
 * and bundled project modes.
 */
export function localizeModes<T extends Pick<ModeConfig, "slug" | "name" | "description">>(
	modes: readonly T[],
	t: TranslateFn,
): T[] {
	return modes.map((mode) => localizeMode(mode, t))
}
