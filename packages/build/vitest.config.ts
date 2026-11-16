import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		// vitest 4 no longer excludes build output by default.
		exclude: [...configDefaults.exclude, "**/dist/**"],
		environment: "node",
		watch: false,
	},
})
