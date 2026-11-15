import { DEFAULT_MODES } from "@bear-code/types"

import {
	BUILTIN_MODE_SLUGS,
	TRANSLATABLE_CUSTOM_MODE_SLUGS,
	getLocalizedModeDescription,
	getLocalizedModeName,
	isBuiltinModeSlug,
	isTranslatableCustomModeSlug,
	isTranslatableModeSlug,
	localizeMode,
	localizeModes,
	resolveModeDescription,
} from "../modeTranslations"

/**
 * Builds a translation function that mimics i18next behaviour: it returns the
 * key itself when the translation is missing.
 */
const makeT = (dictionary: Record<string, string>) => (key: string) => dictionary[key] ?? key

describe("modeTranslations", () => {
	describe("BUILTIN_MODE_SLUGS / isBuiltinModeSlug", () => {
		it("exposes every slug from DEFAULT_MODES", () => {
			expect(BUILTIN_MODE_SLUGS).toEqual(DEFAULT_MODES.map((mode) => mode.slug))
		})

		it("recognises built-in slugs", () => {
			for (const mode of DEFAULT_MODES) {
				expect(isBuiltinModeSlug(mode.slug)).toBe(true)
			}
		})

		it("rejects custom slugs", () => {
			expect(isBuiltinModeSlug("my-custom-mode")).toBe(false)
		})
	})

	describe("TRANSLATABLE_CUSTOM_MODE_SLUGS / isTranslatableCustomModeSlug", () => {
		it("contains the bundled project mode slugs", () => {
			expect(TRANSLATABLE_CUSTOM_MODE_SLUGS).toEqual([
				"translate",
				"issue-fixer",
				"pr-fixer",
				"merge-resolver",
				"docs-extractor",
				"issue-investigator",
				"issue-writer",
			])
		})

		it("recognises bundled project mode slugs", () => {
			for (const slug of TRANSLATABLE_CUSTOM_MODE_SLUGS) {
				expect(isTranslatableCustomModeSlug(slug)).toBe(true)
			}
		})

		it("rejects built-in and unknown slugs", () => {
			expect(isTranslatableCustomModeSlug("code")).toBe(false)
			expect(isTranslatableCustomModeSlug("my-custom-mode")).toBe(false)
		})
	})

	describe("isTranslatableModeSlug", () => {
		it("accepts built-in and bundled project mode slugs", () => {
			expect(isTranslatableModeSlug("code")).toBe(true)
			expect(isTranslatableModeSlug("docs-extractor")).toBe(true)
		})

		it("rejects unknown slugs", () => {
			expect(isTranslatableModeSlug("my-custom-mode")).toBe(false)
		})
	})

	describe("getLocalizedModeName", () => {
		it("returns the translated name for a built-in mode", () => {
			const t = makeT({ "prompts:builtinModes.code.name": "💻 Код" })
			expect(getLocalizedModeName({ slug: "code", name: "💻 Code" }, t)).toBe("💻 Код")
		})

		it("falls back to the original name when the translation is missing", () => {
			const t = makeT({})
			expect(getLocalizedModeName({ slug: "code", name: "💻 Code" }, t)).toBe("💻 Code")
		})

		it("returns the original name for custom modes", () => {
			const t = makeT({ "prompts:builtinModes.my-mode.name": "Should not be used" })
			expect(getLocalizedModeName({ slug: "my-mode", name: "My Mode" }, t)).toBe("My Mode")
		})

		it("returns the translated name for a bundled project mode", () => {
			const t = makeT({ "prompts:customModes.docs-extractor.name": "📚 Извлечение документации" })
			expect(getLocalizedModeName({ slug: "docs-extractor", name: "📚 Docs Extractor" }, t)).toBe(
				"📚 Извлечение документации",
			)
		})

		it("falls back to the original name for a bundled project mode without translation", () => {
			const t = makeT({})
			expect(getLocalizedModeName({ slug: "docs-extractor", name: "📚 Docs Extractor" }, t)).toBe(
				"📚 Docs Extractor",
			)
		})
	})

	describe("getLocalizedModeDescription", () => {
		it("returns the translated description for a built-in mode", () => {
			const t = makeT({ "prompts:builtinModes.code.description": "Пиши код" })
			expect(getLocalizedModeDescription({ slug: "code", description: "Write code" }, t)).toBe("Пиши код")
		})

		it("falls back to the original description when the translation is missing", () => {
			const t = makeT({})
			expect(getLocalizedModeDescription({ slug: "code", description: "Write code" }, t)).toBe("Write code")
		})

		it("returns the original description for custom modes", () => {
			const t = makeT({ "prompts:builtinModes.my-mode.description": "Should not be used" })
			expect(getLocalizedModeDescription({ slug: "my-mode", description: "Custom" }, t)).toBe("Custom")
		})

		it("returns the translated description for a bundled project mode", () => {
			const t = makeT({
				"prompts:customModes.docs-extractor.description":
					"Извлекай детали фич или проверяй точность документации",
			})
			expect(
				getLocalizedModeDescription(
					{
						slug: "docs-extractor",
						description: "Extract feature details or verify documentation accuracy.",
					},
					t,
				),
			).toBe("Извлекай детали фич или проверяй точность документации")
		})

		it("falls back to the original description for a bundled project mode without translation", () => {
			const t = makeT({})
			expect(
				getLocalizedModeDescription(
					{
						slug: "docs-extractor",
						description: "Extract feature details or verify documentation accuracy.",
					},
					t,
				),
			).toBe("Extract feature details or verify documentation accuracy.")
		})

		it("preserves an undefined description", () => {
			const t = makeT({})
			expect(getLocalizedModeDescription({ slug: "code", description: undefined }, t)).toBeUndefined()
		})
	})

	describe("resolveModeDescription", () => {
		const t = makeT({ "prompts:builtinModes.architect.description": "Планирование и проектирование" })

		it("returns the localized description when there is no override", () => {
			expect(resolveModeDescription({ slug: "architect", description: "Plan and design" }, undefined, t)).toBe(
				"Планирование и проектирование",
			)
		})

		it("ignores an override that repeats the untranslated default description", () => {
			expect(
				resolveModeDescription(
					{ slug: "architect", description: "Plan and design before implementation" },
					"Plan and design before implementation",
					t,
				),
			).toBe("Планирование и проектирование")
		})

		it("keeps a genuine user override", () => {
			expect(resolveModeDescription({ slug: "architect", description: "Plan and design" }, "Мой режим", t)).toBe(
				"Мой режим",
			)
		})

		it("returns the override for custom modes", () => {
			expect(resolveModeDescription({ slug: "my-mode", description: "Custom" }, "Custom override", t)).toBe(
				"Custom override",
			)
		})

		it("falls back to the mode description for custom modes without override", () => {
			expect(resolveModeDescription({ slug: "my-mode", description: "Custom" }, undefined, t)).toBe("Custom")
		})

		it("ignores an override that repeats the untranslated default for a bundled project mode", () => {
			const projectT = makeT({
				"prompts:customModes.docs-extractor.description": "Извлекай детали фич",
			})
			expect(
				resolveModeDescription(
					{
						slug: "docs-extractor",
						description: "Extract feature details or verify documentation accuracy.",
					},
					"Extract feature details or verify documentation accuracy.",
					projectT,
				),
			).toBe("Извлекай детали фич")
		})

		it("keeps a genuine user override for a bundled project mode", () => {
			const projectT = makeT({
				"prompts:customModes.docs-extractor.description": "Извлекай детали фич",
			})
			expect(
				resolveModeDescription(
					{
						slug: "docs-extractor",
						description: "Extract feature details or verify documentation accuracy.",
					},
					"Моё описание",
					projectT,
				),
			).toBe("Моё описание")
		})
	})

	describe("localizeMode", () => {
		it("localizes name and description while preserving other fields", () => {
			const t = makeT({
				"prompts:builtinModes.code.name": "💻 Код",
				"prompts:builtinModes.code.description": "Пиши код",
			})
			const mode = {
				slug: "code",
				name: "💻 Code",
				description: "Write code",
				groups: ["read", "edit"],
				roleDefinition: "You are Bear",
			}

			const result = localizeMode(mode, t)

			expect(result).toEqual({
				slug: "code",
				name: "💻 Код",
				description: "Пиши код",
				groups: ["read", "edit"],
				roleDefinition: "You are Bear",
			})
		})

		it("does not mutate the original mode", () => {
			const t = makeT({ "prompts:builtinModes.code.name": "💻 Код" })
			const mode = { slug: "code", name: "💻 Code", description: "Write code" }

			localizeMode(mode, t)

			expect(mode.name).toBe("💻 Code")
		})

		it("leaves custom modes untouched", () => {
			const t = makeT({})
			const mode = { slug: "my-mode", name: "My Mode", description: "Custom" }

			expect(localizeMode(mode, t)).toEqual(mode)
		})

		it("localizes a bundled project mode", () => {
			const t = makeT({
				"prompts:customModes.docs-extractor.name": "📚 Извлечение документации",
				"prompts:customModes.docs-extractor.description": "Извлекай детали фич",
			})
			const mode = {
				slug: "docs-extractor",
				name: "📚 Docs Extractor",
				description: "Extract feature details or verify documentation accuracy.",
			}

			expect(localizeMode(mode, t)).toEqual({
				slug: "docs-extractor",
				name: "📚 Извлечение документации",
				description: "Извлекай детали фич",
			})
		})
	})

	describe("localizeModes", () => {
		it("localizes every built-in mode in the list", () => {
			const t = makeT({
				"prompts:builtinModes.code.name": "💻 Код",
				"prompts:builtinModes.ask.name": "❓ Вопрос",
			})
			const modes = [
				{ slug: "code", name: "💻 Code", description: "Write code" },
				{ slug: "ask", name: "❓ Ask", description: "Ask questions" },
				{ slug: "my-mode", name: "My Mode", description: "Custom" },
			]

			const result = localizeModes(modes, t)

			expect(result.map((mode) => mode.name)).toEqual(["💻 Код", "❓ Вопрос", "My Mode"])
		})

		it("localizes bundled project modes alongside built-in modes", () => {
			const t = makeT({
				"prompts:builtinModes.code.name": "💻 Код",
				"prompts:customModes.docs-extractor.name": "📚 Извлечение документации",
			})
			const modes = [
				{ slug: "code", name: "💻 Code", description: "Write code" },
				{ slug: "docs-extractor", name: "📚 Docs Extractor", description: "Extract docs" },
				{ slug: "my-mode", name: "My Mode", description: "Custom" },
			]

			const result = localizeModes(modes, t)

			expect(result.map((mode) => mode.name)).toEqual(["💻 Код", "📚 Извлечение документации", "My Mode"])
		})

		it("returns an empty array for an empty input", () => {
			expect(localizeModes([], makeT({}))).toEqual([])
		})
	})
})
