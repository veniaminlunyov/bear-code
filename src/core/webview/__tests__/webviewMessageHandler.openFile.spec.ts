// npx vitest core/webview/__tests__/webviewMessageHandler.openFile.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"

vi.mock("../../../api/providers/fetchers/modelCache")

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showTextDocument: vi.fn(),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
		openTextDocument: vi.fn().mockResolvedValue({}),
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

vi.mock("fs/promises", () => {
	const readFile = vi.fn().mockResolvedValue("file content here")
	return {
		default: {
			rm: vi.fn(),
			mkdir: vi.fn(),
			readFile,
			writeFile: vi.fn(),
		},
		rm: vi.fn(),
		mkdir: vi.fn(),
		readFile,
		writeFile: vi.fn(),
	}
})

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

vi.mock("../../../utils/pathUtils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/pathUtils")>()
	return {
		decodeUntrustedPathToStable: actual.decodeUntrustedPathToStable,
		isPathOutsideWorkspace: vi.fn((filePath: string) => {
			const nodePath = require("path")
			const normalized = nodePath.resolve(filePath)
			const workspaceRoot = nodePath.resolve("/mock/workspace")
			return !(normalized === workspaceRoot || normalized.startsWith(workspaceRoot + nodePath.sep))
		}),
		isRealPathOutsideWorkspace: vi.fn().mockResolvedValue(false),
	}
})

vi.mock("../../../integrations/misc/open-file", () => ({
	openFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({
		text,
		images: [...(images ?? [])],
	})),
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import * as vscode from "vscode"
import { openFile } from "../../../integrations/misc/open-file"
import { isRealPathOutsideWorkspace } from "../../../utils/pathUtils"

const MOCK_CWD = "/mock/workspace/project"

const mockProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
	},
	contextProxy: {
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
	},
	log: vi.fn(),
	postStateToWebview: vi.fn(),
	getCurrentTask: vi.fn().mockReturnValue({ cwd: MOCK_CWD }),
	getTaskWithId: vi.fn(),
	createTaskWithHistoryItem: vi.fn(),
	cwd: MOCK_CWD,
} as unknown as ClineProvider

describe("webviewMessageHandler - openFile workspace containment", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(isRealPathOutsideWorkspace).mockResolvedValue(false)
		vi.mocked(mockProvider.getCurrentTask).mockReturnValue({ cwd: MOCK_CWD } as any)
	})

	const open = (text: string, values?: Record<string, unknown>) =>
		webviewMessageHandler(mockProvider, { type: "openFile", text, values })

	it("opens a markdown link inside the workspace with only the line option", async () => {
		await open("./src/index.ts", { fromMarkdown: true, line: 3, create: true, content: "x" })

		expect(openFile).toHaveBeenCalledWith(path.join(MOCK_CWD, "src/index.ts"), { line: 3 })
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it.each([
		["an absolute path", "/etc/passwd"],
		["a ../ traversal", "./../../../etc/passwd"],
		["a percent-encoded traversal", "./%2e%2e/%2e%2e/%2e%2e/etc/passwd"],
		["a double-encoded traversal", "./%252e%252e/%252e%252e/%252e%252e/etc/passwd"],
	])("rejects %s from a markdown link", async (_name, text) => {
		await open(text, { fromMarkdown: true })

		expect(openFile).not.toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.cannot_access_path")
	})

	it("rejects a markdown link whose real path escapes through a symlink", async () => {
		vi.mocked(isRealPathOutsideWorkspace).mockResolvedValue(true)

		await open("./link/secret", { fromMarkdown: true })

		expect(isRealPathOutsideWorkspace).toHaveBeenCalledWith(path.join(MOCK_CWD, "link/secret"))
		expect(openFile).not.toHaveBeenCalled()
	})

	it("keeps first-party openFile requests outside the workspace working", async () => {
		const values = { create: true, content: "{}" }
		await open("/home/me/.bear/settings.json", values)

		expect(openFile).toHaveBeenCalledWith("/home/me/.bear/settings.json", values)
		expect(isRealPathOutsideWorkspace).not.toHaveBeenCalled()
	})

	it("ignores an empty path", async () => {
		await open("")

		expect(openFile).not.toHaveBeenCalled()
	})
})
