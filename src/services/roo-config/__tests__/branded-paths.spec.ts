// npx vitest run services/roo-config/__tests__/branded-paths.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const { mockHomedir, mockExecuteRipgrep } = vi.hoisted(() => ({
	mockHomedir: vi.fn(),
	mockExecuteRipgrep: vi.fn(),
}))

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	return { ...actual, homedir: mockHomedir }
})

vi.mock("../../search/file-search", () => ({
	executeRipgrep: mockExecuteRipgrep,
}))

import {
	discoverSubfolderRooDirectories,
	getGlobalRooDirectory,
	getProjectModesFilePath,
	getProjectRooDirectoryForCwd,
	isProjectModesFile,
	resolveBrandedPath,
	resolveWorkspaceConfigPath,
} from "../index"

describe("BearCode config names with legacy Roo Code fallback", () => {
	let tmp: string

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bearcode-paths-"))
		mockHomedir.mockReturnValue(path.join(tmp, "home"))
		fs.mkdirSync(path.join(tmp, "home"))
	})

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	describe("resolveBrandedPath", () => {
		it("returns the BearCode name when nothing exists", () => {
			expect(resolveBrandedPath(tmp, ".bear", ".roo")).toBe(path.join(tmp, ".bear"))
		})

		it("falls back to the legacy name when only it exists", () => {
			fs.mkdirSync(path.join(tmp, ".roo"))
			expect(resolveBrandedPath(tmp, ".bear", ".roo")).toBe(path.join(tmp, ".roo"))
		})

		it("prefers the BearCode name when both exist", () => {
			fs.mkdirSync(path.join(tmp, ".roo"))
			fs.mkdirSync(path.join(tmp, ".bear"))
			expect(resolveBrandedPath(tmp, ".bear", ".roo")).toBe(path.join(tmp, ".bear"))
		})
	})

	describe("config directories", () => {
		it("uses .bear for project and global dirs by default", () => {
			expect(getProjectRooDirectoryForCwd(tmp)).toBe(path.join(tmp, ".bear"))
			expect(getGlobalRooDirectory()).toBe(path.join(tmp, "home", ".bear"))
		})

		it("falls back to existing legacy .roo dirs", () => {
			fs.mkdirSync(path.join(tmp, ".roo"))
			fs.mkdirSync(path.join(tmp, "home", ".roo"))
			expect(getProjectRooDirectoryForCwd(tmp)).toBe(path.join(tmp, ".roo"))
			expect(getGlobalRooDirectory()).toBe(path.join(tmp, "home", ".roo"))
		})
	})

	describe("project modes file", () => {
		it("uses .bearmodes by default and .roomodes as fallback", () => {
			expect(getProjectModesFilePath(tmp)).toBe(path.join(tmp, ".bearmodes"))
			fs.writeFileSync(path.join(tmp, ".roomodes"), "customModes: []")
			expect(getProjectModesFilePath(tmp)).toBe(path.join(tmp, ".roomodes"))
			fs.writeFileSync(path.join(tmp, ".bearmodes"), "customModes: []")
			expect(getProjectModesFilePath(tmp)).toBe(path.join(tmp, ".bearmodes"))
		})

		it("recognizes both names as project modes files", () => {
			expect(isProjectModesFile("/w/.bearmodes")).toBe(true)
			expect(isProjectModesFile("/w/.roomodes")).toBe(true)
			expect(isProjectModesFile("/w/custom_modes.yaml")).toBe(false)
		})
	})

	describe("resolveWorkspaceConfigPath", () => {
		it("maps .bear paths to legacy .roo when only .roo exists", () => {
			fs.mkdirSync(path.join(tmp, ".roo"))
			fs.writeFileSync(path.join(tmp, ".roomodes"), "customModes: []")
			expect(resolveWorkspaceConfigPath(tmp, "./.bear/rules/rules.md")).toBe(
				path.join(tmp, ".roo", "rules", "rules.md"),
			)
			expect(resolveWorkspaceConfigPath(tmp, "./.bearmodes")).toBe(path.join(tmp, ".roomodes"))
		})

		it("keeps BearCode names when no legacy files exist and leaves other paths alone", () => {
			expect(resolveWorkspaceConfigPath(tmp, "./.bear/rules/rules.md")).toBe(
				path.join(tmp, ".bear", "rules", "rules.md"),
			)
			expect(resolveWorkspaceConfigPath(tmp, "src/index.ts")).toBe(path.join(tmp, "src", "index.ts"))
		})
	})

	describe("discoverSubfolderRooDirectories", () => {
		it("finds .bear and legacy .roo subfolders, preferring .bear in the same folder", async () => {
			mockExecuteRipgrep.mockResolvedValue([
				{ path: ".bear/rules/root.md", type: "file", label: "root.md" },
				{ path: "pkg-a/.roo/rules/a.md", type: "file", label: "a.md" },
				{ path: "pkg-b/.bear/rules/b.md", type: "file", label: "b.md" },
				{ path: "pkg-b/.roo/rules/old.md", type: "file", label: "old.md" },
			])

			const dirs = await discoverSubfolderRooDirectories(tmp)

			expect(dirs).toEqual([path.join(tmp, "pkg-a", ".roo"), path.join(tmp, "pkg-b", ".bear")])
		})
	})
})
