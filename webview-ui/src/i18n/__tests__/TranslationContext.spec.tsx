import React from "react"

import { act, render } from "@/utils/test-utils"

import TranslationProvider, { useAppTranslation } from "../TranslationContext"

// Mutable language state so individual tests can simulate the user switching
// the UI language and assert that consumers re-render with new strings.
const extensionStateMock = vi.hoisted(() => ({ language: "en" }))

// Minimal external store so `useExtensionState` behaves like the real hook:
// it subscribes to language changes and re-renders the provider in place
// (instead of remounting it), which is what happens in the real app.
const languageStore = vi.hoisted(() => {
	const listeners = new Set<() => void>()
	return {
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		setLanguage(language: string) {
			extensionStateMock.language = language
			listeners.forEach((listener) => listener())
		},
	}
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => {
		const [, forceRender] = React.useReducer((n: number) => n + 1, 0)
		React.useEffect(() => languageStore.subscribe(forceRender), [])
		return {
			language: extensionStateMock.language,
		}
	},
}))

// Translation function that returns a language-specific string so we can
// observe whether consumers re-render after the language changes.
//
// The `i18n` object is created once (hoisted) and reused across calls, which
// mirrors the real `react-i18next` hook where `i18n` is a stable singleton.
// If it were recreated on every call, the provider's memoized context value
// would always be new and the regression this test guards against would be
// masked.
const translateMock = vi.hoisted(() => {
	const fn = (key: string, options?: Record<string, any>) => {
		if (key === "settings.autoApprove.title") {
			return extensionStateMock.language === "ru" ? "Автоодобрение" : "Auto-Approve"
		}
		if (key === "notifications.error") {
			return options?.message ? `Operation failed: ${options.message}` : "Operation failed"
		}
		return key
	}

	const i18n = {
		t: fn,
		changeLanguage: () => Promise.resolve(),
	}

	return { fn, i18n }
})

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: translateMock.i18n,
	}),
}))

vi.mock("../setup", () => ({
	default: translateMock.i18n,
	loadTranslations: () => {},
}))

const TestComponent = () => {
	const { t } = useAppTranslation()
	return (
		<div>
			<h1 data-testid="translation-test">{t("settings.autoApprove.title")}</h1>
			<p data-testid="translation-interpolation">{t("notifications.error", { message: "Test error" })}</p>
		</div>
	)
}

// A consumer that is memoized on its own props. It only re-renders when the
// context value it reads changes, which is exactly the situation the fix
// targets: components that read `t` from context and are otherwise memoized.
const MemoizedConsumer = React.memo(() => {
	const { t } = useAppTranslation()
	return <h1 data-testid="memoized-translation">{t("settings.autoApprove.title")}</h1>
})

describe("TranslationContext", () => {
	beforeEach(() => {
		extensionStateMock.language = "en"
	})

	it("should provide translations via context", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if translation is provided correctly
		expect(getByTestId("translation-test")).toHaveTextContent("Auto-Approve")
	})

	it("should handle interpolation correctly", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if interpolation works
		expect(getByTestId("translation-interpolation")).toHaveTextContent("Operation failed: Test error")
	})

	it("should re-render memoized consumers with new strings when the language changes", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<MemoizedConsumer />
			</TranslationProvider>,
		)

		expect(getByTestId("memoized-translation")).toHaveTextContent("Auto-Approve")

		// Simulate the user switching the UI language. The provider re-renders
		// in place; the memoized consumer has unchanged props, so it can only
		// pick up the new language through a new context value.
		act(() => {
			languageStore.setLanguage("ru")
		})

		expect(getByTestId("memoized-translation")).toHaveTextContent("Автоодобрение")
	})
})
