// npx vitest run services/ripgrep/__tests__/getBinPath.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

vi.mock("vscode", () => ({ env: { appRoot: "" } }))

import { getBinPath, ripgrepCandidatePaths } from "../index"

const binName = process.platform.startsWith("win") ? "rg.exe" : "rg"

describe("getBinPath", () => {
	let appRoot: string

	beforeEach(() => {
		appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bear-rg-"))
	})

	afterEach(() => {
		fs.rmSync(appRoot, { recursive: true, force: true })
	})

	const install = (relDir: string) => {
		const dir = path.join(appRoot, relDir)
		fs.mkdirSync(dir, { recursive: true })
		const bin = path.join(dir, binName)
		fs.writeFileSync(bin, "")
		return bin
	}

	it("returns undefined when ripgrep is not installed", async () => {
		expect(await getBinPath(appRoot)).toBeUndefined()
	})

	it.each([
		["classic @vscode/ripgrep", "node_modules/@vscode/ripgrep/bin"],
		["asar-unpacked @vscode/ripgrep", "node_modules.asar.unpacked/@vscode/ripgrep/bin"],
		[
			"@vscode/ripgrep-universal (VS Code 1.122+)",
			`node_modules/@vscode/ripgrep-universal/bin/${process.platform}-${process.arch}`,
		],
		[
			"asar-unpacked @vscode/ripgrep-universal",
			`node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/${process.platform}-${process.arch}`,
		],
		["platform package (VS Code 1.130+)", `node_modules/@vscode/ripgrep-${process.platform}-${process.arch}/bin`],
		[
			"asar-unpacked platform package",
			`node_modules.asar.unpacked/@vscode/ripgrep-${process.platform}-${process.arch}/bin`,
		],
	])("finds the %s layout", async (_name, relDir) => {
		const bin = install(relDir)
		expect(await getBinPath(appRoot)).toBe(bin)
	})

	it("prefers the classic layout when several exist", async () => {
		const classic = install("node_modules/@vscode/ripgrep/bin")
		install(`node_modules/@vscode/ripgrep-universal/bin/${process.platform}-${process.arch}`)
		expect(await getBinPath(appRoot)).toBe(classic)
	})

	it("honors npm_config_arch for the platform package", () => {
		const previous = process.env.npm_config_arch
		process.env.npm_config_arch = "fake-arch"
		try {
			expect(ripgrepCandidatePaths(appRoot)).toContain(
				path.join(appRoot, `node_modules/@vscode/ripgrep-${process.platform}-fake-arch/bin`, binName),
			)
		} finally {
			if (previous === undefined) delete process.env.npm_config_arch
			else process.env.npm_config_arch = previous
		}
	})
})
