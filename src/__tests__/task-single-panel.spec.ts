// npx vitest run __tests__/task-single-panel.spec.ts

import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(() => ({ get: vi.fn((_key: string, fallback: unknown) => fallback), update: vi.fn() })),
		workspaceFolders: [],
	},
	env: { machineId: "test", uriScheme: "vscode", appName: "VSCode", language: "en", sessionId: "s" },
	Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
	commands: { executeCommand: vi.fn() },
	ExtensionMode: { Development: 2 },
	ConfigurationTarget: { Global: 1 },
	version: "1.0.0-test",
}))

import * as vscode from "vscode"
import { ClineProvider } from "../core/webview/ClineProvider"

const instances = (ClineProvider as any).activeInstances as Set<unknown>

function makeProvider(currentTaskId?: string) {
	return {
		getCurrentTask: vi.fn(() => (currentTaskId ? { taskId: currentTaskId } : undefined)),
		getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { id: "task-1" } }),
		createTaskWithHistoryItem: vi.fn().mockResolvedValue(undefined),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		revealView: vi.fn(),
	}
}

const showTaskWithId = (provider: unknown, id: string) =>
	(ClineProvider.prototype as any).showTaskWithId.call(provider, id)

describe("opening a task that another panel already shows", () => {
	const added: unknown[] = []
	const register = (provider: unknown) => {
		instances.add(provider)
		added.push(provider)
	}

	afterEach(() => {
		added.splice(0).forEach((provider) => instances.delete(provider))
		vi.clearAllMocks()
	})

	it("reveals the panel that has it open instead of opening a second instance", async () => {
		const sidebar = makeProvider("task-1")
		const tab = makeProvider()
		register(sidebar)
		register(tab)

		await showTaskWithId(tab, "task-1")

		expect(sidebar.revealView).toHaveBeenCalledTimes(1)
		expect(tab.getTaskWithId).not.toHaveBeenCalled()
		expect(tab.createTaskWithHistoryItem).not.toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
	})

	it("opens the task here when no other panel has it open", async () => {
		const sidebar = makeProvider("other-task")
		const tab = makeProvider()
		register(sidebar)
		register(tab)

		await showTaskWithId(tab, "task-1")

		expect(sidebar.revealView).not.toHaveBeenCalled()
		expect(tab.createTaskWithHistoryItem).toHaveBeenCalledWith({ id: "task-1" })
	})

	it("does nothing new when this panel already shows the task", async () => {
		const tab = makeProvider("task-1")
		register(tab)

		await showTaskWithId(tab, "task-1")

		expect(tab.createTaskWithHistoryItem).not.toHaveBeenCalled()
		expect(tab.postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "chatButtonClicked" })
	})
})

describe("ClineProvider.revealView()", () => {
	it("reveals an editor-tab panel in its column", () => {
		const view = { reveal: vi.fn(), viewColumn: 2 }
		;(ClineProvider.prototype as any).revealView.call({ view })
		expect(view.reveal).toHaveBeenCalledWith(2)
	})

	it("shows the sidebar view", () => {
		const view = { show: vi.fn() }
		;(ClineProvider.prototype as any).revealView.call({ view })
		expect(view.show).toHaveBeenCalledWith(false)
	})
})
