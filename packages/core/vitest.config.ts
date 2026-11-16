import os from "os"
import { realpathSync } from "fs"

import path from "path"

import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
	server: {
		fs: {
			// Custom tool tests bundle tools into os.tmpdir() and import them from there;
			// vite >= 6.4 only serves files from allowed directories.
			allow: [
				path.resolve(__dirname, "../.."),
				os.tmpdir(),
				realpathSync(os.tmpdir()),
				realpathSync.native(os.tmpdir()),
			],
		},
	},
	test: {
		globals: true,
		// vitest 4 no longer excludes build output by default.
		exclude: [...configDefaults.exclude, "**/dist/**"],
		environment: "node",
		watch: false,
	},
})
