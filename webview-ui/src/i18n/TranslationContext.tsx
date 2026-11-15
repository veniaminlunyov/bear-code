import React, { createContext, useContext, ReactNode, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import i18next, { loadTranslations } from "./setup"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Initialize with default configuration
	const { i18n } = useTranslation()
	// Get the extension state directly - it already contains all state properties
	const extensionState = useExtensionState()

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	useEffect(() => {
		i18n.changeLanguage(extensionState.language)
	}, [i18n, extensionState.language])

	// Memoize the translation function to prevent unnecessary re-renders.
	// The language is captured in the closure so that the memoized function is
	// recreated whenever the user switches the UI language. This makes
	// consumers of `useAppTranslation()` re-render (and re-evaluate `t(...)`);
	// without it, components that only read `t` from the context would keep
	// showing strings from the previous language until some unrelated state
	// change forced a re-render.
	const language = extensionState.language
	const translate = useCallback(
		(key: string, options?: Record<string, any>) => {
			// Passing `lng` explicitly keeps the closure tied to the current
			// language and makes the dependency below meaningful to the linter.
			return i18n.t(key, { ...options, lng: language })
		},
		[i18n, language],
	)

	// Recreate the context value whenever the language or translation function
	// changes so that all consumers receive the updated value and re-render.
	const contextValue = useMemo(
		() => ({
			t: translate,
			i18n,
		}),
		[translate, i18n],
	)

	return <TranslationContext.Provider value={contextValue}>{children}</TranslationContext.Provider>
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
