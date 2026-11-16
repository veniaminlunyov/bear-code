// npx vitest utils/__tests__/pathUtils.containment.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const workspace = vi.hoisted(() => ({ folders: [] as { uri: { fsPath: string } }[] | undefined }))

vi.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return workspace.folders
		},
	},
}))

import { decodeUntrustedPathToStable, isRealPathOutsideWorkspace } from "../pathUtils"

describe("decodeUntrustedPathToStable", () => {
	it("returns plain paths unchanged", () => {
		expect(decodeUntrustedPathToStable("src/index.ts")).toBe("src/index.ts")
	})

	it("decodes single and double encoding to a fixed point", () => {
		expect(decodeUntrustedPathToStable("%2e%2e/x")).toBe("../x")
		expect(decodeUntrustedPathToStable("%252e%252e/x")).toBe("../x")
	})

	it("keeps a bare percent sign as-is", () => {
		expect(decodeUntrustedPathToStable("report 50%.md")).toBe("report 50%.md")
	})

	it("rejects an encoding that does not stabilize within the bound", () => {
		let value = "%2e"
		for (let i = 0; i < 5; i++) value = encodeURIComponent(value)
		expect(decodeUntrustedPathToStable(value, 3)).toBeNull()
	})
})

describe("isRealPathOutsideWorkspace", () => {
	let root: string
	let ws: string
	let outside: string

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bear-containment-")))
		ws = path.join(root, "ws")
		outside = path.join(root, "outside")
		fs.mkdirSync(path.join(ws, "src"), { recursive: true })
		fs.mkdirSync(outside)
		fs.writeFileSync(path.join(ws, "src", "a.ts"), "")
		fs.writeFileSync(path.join(outside, "secret"), "")
		workspace.folders = [{ uri: { fsPath: ws } }]
	})

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true })
	})

	it("treats an existing file inside the workspace as inside", async () => {
		expect(await isRealPathOutsideWorkspace(path.join(ws, "src", "a.ts"))).toBe(false)
	})

	it("checks a not-yet-existing file through its deepest existing ancestor", async () => {
		expect(await isRealPathOutsideWorkspace(path.join(ws, "new", "dir", "file.ts"))).toBe(false)
	})

	it("flags a symlink inside the workspace that points outside", async () => {
		fs.symlinkSync(outside, path.join(ws, "link"))
		expect(await isRealPathOutsideWorkspace(path.join(ws, "link", "secret"))).toBe(true)
	})

	it("fails closed on a dangling symlink", async () => {
		fs.symlinkSync(path.join(outside, "missing"), path.join(ws, "dangling"))
		expect(await isRealPathOutsideWorkspace(path.join(ws, "dangling"))).toBe(true)
	})

	it("accepts paths under a workspace root that is itself a symlink", async () => {
		const linkedRoot = path.join(root, "ws-link")
		fs.symlinkSync(ws, linkedRoot)
		workspace.folders = [{ uri: { fsPath: linkedRoot } }]
		expect(await isRealPathOutsideWorkspace(path.join(ws, "src", "a.ts"))).toBe(false)
	})

	it("treats everything as outside when no workspace is open", async () => {
		workspace.folders = undefined
		expect(await isRealPathOutsideWorkspace(path.join(ws, "src", "a.ts"))).toBe(true)
	})
})
