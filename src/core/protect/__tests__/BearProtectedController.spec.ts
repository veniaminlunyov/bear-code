import path from "path"
import { BearProtectedController } from "../BearProtectedController"

describe("BearProtectedController", () => {
	const TEST_CWD = "/test/workspace"
	let controller: BearProtectedController

	beforeEach(() => {
		controller = new BearProtectedController(TEST_CWD)
	})

	describe("isWriteProtected", () => {
		it("should protect .bearignore file", () => {
			expect(controller.isWriteProtected(".bearignore")).toBe(true)
		})

		it("should protect files in .bear directory", () => {
			expect(controller.isWriteProtected(".bear/config.json")).toBe(true)
			expect(controller.isWriteProtected(".bear/settings/user.json")).toBe(true)
			expect(controller.isWriteProtected(".bear/modes/custom.json")).toBe(true)
		})

		it("should protect .bearprotected file", () => {
			expect(controller.isWriteProtected(".bearprotected")).toBe(true)
		})

		it("should protect .bearmodes files", () => {
			expect(controller.isWriteProtected(".bearmodes")).toBe(true)
		})

		it("should protect .bearrules* files", () => {
			expect(controller.isWriteProtected(".bearrules")).toBe(true)
			expect(controller.isWriteProtected(".bearrules.md")).toBe(true)
		})

		it("should protect .clinerules* files", () => {
			expect(controller.isWriteProtected(".clinerules")).toBe(true)
			expect(controller.isWriteProtected(".clinerules.md")).toBe(true)
		})

		it("should protect files in .vscode directory", () => {
			expect(controller.isWriteProtected(".vscode/settings.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/launch.json")).toBe(true)
			expect(controller.isWriteProtected(".vscode/tasks.json")).toBe(true)
		})

		it("should protect .code-workspace files", () => {
			expect(controller.isWriteProtected("myproject.code-workspace")).toBe(true)
			expect(controller.isWriteProtected("pentest.code-workspace")).toBe(true)
			expect(controller.isWriteProtected(".code-workspace")).toBe(true)
			expect(controller.isWriteProtected("folder/workspace.code-workspace")).toBe(true)
		})

		it("should protect AGENTS.md file", () => {
			expect(controller.isWriteProtected("AGENTS.md")).toBe(true)
		})

		it("should protect AGENT.md file", () => {
			expect(controller.isWriteProtected("AGENT.md")).toBe(true)
		})

		it("should not protect other files starting with .bear", () => {
			expect(controller.isWriteProtected(".roosettings")).toBe(false)
			expect(controller.isWriteProtected(".rooconfig")).toBe(false)
		})

		it("should not protect regular files", () => {
			expect(controller.isWriteProtected("src/index.ts")).toBe(false)
			expect(controller.isWriteProtected("package.json")).toBe(false)
			expect(controller.isWriteProtected("README.md")).toBe(false)
		})

		it("should not protect files that contain 'roo' but don't start with .bear", () => {
			expect(controller.isWriteProtected("src/bear-utils.ts")).toBe(false)
			expect(controller.isWriteProtected("config/roo.config.js")).toBe(false)
		})

		it("should handle nested paths correctly", () => {
			expect(controller.isWriteProtected(".bear/config.json")).toBe(true) // .bear/** matches at root
			expect(controller.isWriteProtected("nested/.bearignore")).toBe(true) // .bearignore matches anywhere by default
			expect(controller.isWriteProtected("nested/.bearmodes")).toBe(true) // .bearmodes matches anywhere by default
			expect(controller.isWriteProtected("nested/.bearrules.md")).toBe(true) // .bearrules* matches anywhere by default
		})

		it("should handle absolute paths by converting to relative", () => {
			const absolutePath = path.join(TEST_CWD, ".bearignore")
			expect(controller.isWriteProtected(absolutePath)).toBe(true)
		})

		it("should handle paths with different separators", () => {
			expect(controller.isWriteProtected(".bear\\config.json")).toBe(true)
			expect(controller.isWriteProtected(".bear/config.json")).toBe(true)
		})

		it("should not throw for absolute paths outside cwd", () => {
			expect(controller.isWriteProtected("/tmp/comment-2-pr63.json")).toBe(false)
			expect(controller.isWriteProtected("/etc/passwd")).toBe(false)
		})
	})

	describe("getProtectedFiles", () => {
		it("should return set of protected files from a list", () => {
			const files = ["src/index.ts", ".bearignore", "package.json", ".bear/config.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set([".bearignore", ".bear/config.json"]))
		})

		it("should return empty set when no files are protected", () => {
			const files = ["src/index.ts", "package.json", "README.md"]

			const protectedFiles = controller.getProtectedFiles(files)

			expect(protectedFiles).toEqual(new Set())
		})
	})

	describe("annotatePathsWithProtection", () => {
		it("should annotate paths with protection status", () => {
			const files = ["src/index.ts", ".bearignore", ".bear/config.json", "package.json"]

			const annotated = controller.annotatePathsWithProtection(files)

			expect(annotated).toEqual([
				{ path: "src/index.ts", isProtected: false },
				{ path: ".bearignore", isProtected: true },
				{ path: ".bear/config.json", isProtected: true },
				{ path: "package.json", isProtected: false },
			])
		})
	})

	describe("getProtectionMessage", () => {
		it("should return appropriate protection message", () => {
			const message = controller.getProtectionMessage()
			expect(message).toBe("This is a BearCode configuration file and requires approval for modifications")
		})
	})

	describe("getInstructions", () => {
		it("should return formatted instructions about protected files", () => {
			const instructions = controller.getInstructions()

			expect(instructions).toContain("# Protected Files")
			expect(instructions).toContain("write-protected")
			expect(instructions).toContain(".bearignore")
			expect(instructions).toContain(".bear/**")
			expect(instructions).toContain("\u{1F6E1}") // Shield symbol
		})
	})

	describe("getProtectedPatterns", () => {
		it("should return the list of protected patterns", () => {
			const patterns = BearProtectedController.getProtectedPatterns()

			expect(patterns).toEqual([
				".bearignore",
				".bearmodes",
				".bearrules*",
				".bear/**",
				".bearprotected",
				".rooignore",
				".roomodes",
				".roorules*",
				".roo/**",
				".rooprotected",
				".clinerules*",
				".vscode/**",
				"*.code-workspace",
				"AGENTS.md",
				"AGENT.md",
			])
		})
	})
})
