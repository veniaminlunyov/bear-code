// npx vitest run src/integrations/terminal/__tests__/TerminalRegistry.spec.ts

import * as vscode from "vscode"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

const PAGER = process.platform === "win32" ? "" : "cat"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalRegistry", () => {
	let mockCreateTerminal: any

	beforeEach(() => {
		mockCreateTerminal = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
			(...args: any[]) =>
				({
					exitStatus: undefined,
					name: "BearCode",
					processId: Promise.resolve(123),
					creationOptions: {},
					state: {
						isInteractedWith: true,
						shell: { id: "test-shell", executable: "/bin/bash", args: [] },
					},
					dispose: vi.fn(),
					hide: vi.fn(),
					show: vi.fn(),
					sendText: vi.fn(),
					shellIntegration: {
						executeCommand: vi.fn(),
					},
				}) as any,
		)
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: "BearCode",
				iconPath: expect.any(Object),
				env: {
					PAGER,
					BEAR_ACTIVE: "true",
					VTE_VERSION: "0",
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "BearCode",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						BEAR_ACTIVE: "true",
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "BearCode",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						BEAR_ACTIVE: "true",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "BearCode",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						BEAR_ACTIVE: "true",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	describe("shell execution end event racing the start event", () => {
		let startHandler: (e: any) => Promise<void>
		let endHandler: (e: any) => Promise<void>

		beforeEach(() => {
			TerminalRegistry["isInitialized"] = false

			// The global vscode mock doesn't define the shell execution events.
			;(vscode.window as any).onDidStartTerminalShellExecution ??= () => ({ dispose: () => {} })
			;(vscode.window as any).onDidEndTerminalShellExecution ??= () => ({ dispose: () => {} })

			vi.spyOn(vscode.window, "onDidStartTerminalShellExecution" as any).mockImplementation((handler: any) => {
				startHandler = handler
				return { dispose: vi.fn() }
			})

			vi.spyOn(vscode.window, "onDidEndTerminalShellExecution" as any).mockImplementation((handler: any) => {
				endHandler = handler
				return { dispose: vi.fn() }
			})

			vi.spyOn(console, "info").mockImplementation(() => {})

			TerminalRegistry.initialize()
		})

		afterEach(() => {
			TerminalRegistry.cleanup()
			TerminalRegistry["isInitialized"] = false
			vi.mocked(console.info).mockRestore()
		})

		it("delivers completion when the end event fires before running is set", async () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			const mockProcess = {
				command: "echo hello",
				emit: vi.fn(),
				hasUnretrievedOutput: vi.fn().mockReturnValue(false),
			} as any
			terminal.process = mockProcess
			terminal.busy = true

			expect(terminal.running).toBe(false)

			await endHandler({
				terminal: terminal.terminal,
				execution: { commandLine: { value: "echo hello" } },
				exitCode: 0,
			})

			expect(mockProcess.emit).toHaveBeenCalledWith(
				"shell_execution_complete",
				expect.objectContaining({ exitCode: 0 }),
			)
			expect(mockProcess.emit).toHaveBeenCalledTimes(1)
			expect(terminal.busy).toBe(false)
			expect(terminal.running).toBe(false)
		})

		it("clears busy without signalling completion when no process exists", async () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			terminal.busy = true
			terminal.process = undefined
			const completeSpy = vi.spyOn(terminal, "shellExecutionComplete")

			await endHandler({
				terminal: terminal.terminal,
				execution: { commandLine: { value: "echo hello" } },
				exitCode: 0,
			})

			expect(terminal.busy).toBe(false)
			expect(completeSpy).not.toHaveBeenCalled()
		})

		it("ignores a start event that arrives after its execution already ended", async () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			const mockProcess = {
				command: "echo hello",
				emit: vi.fn(),
				hasUnretrievedOutput: vi.fn().mockReturnValue(false),
			} as any
			terminal.process = mockProcess
			terminal.busy = true

			const execution = { commandLine: { value: "echo hello" }, read: vi.fn(() => (async function* () {})()) }

			await endHandler({ terminal: terminal.terminal, execution, exitCode: 0 })
			expect(terminal.busy).toBe(false)

			const setActiveStreamSpy = vi.spyOn(terminal, "setActiveStream")
			await startHandler({ terminal: terminal.terminal, execution })

			expect(setActiveStreamSpy).not.toHaveBeenCalled()
			expect(terminal.busy).toBe(false)
		})

		it("still marks the terminal busy for a start event of a command it did not start", async () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			const execution = { commandLine: { value: "npm run dev" }, read: vi.fn(() => (async function* () {})()) }
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// A command typed by the user into the terminal: no Bear process attached.
			await startHandler({ terminal: terminal.terminal, execution })

			expect(terminal.busy).toBe(true)
			consoleWarnSpy.mockRestore()
		})
	})

	describe("releaseTerminalsForTask", () => {
		it("aborts a busy terminal's running process and disassociates it from the task", () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode")
			const abort = vi.fn()
			terminal.taskId = "task-busy"
			terminal.busy = true
			terminal.process = { abort } as any

			TerminalRegistry.releaseTerminalsForTask("task-busy")

			expect(abort).toHaveBeenCalledTimes(1)
			expect(terminal.taskId).toBeUndefined()
		})

		it("does not abort an idle terminal but still disassociates it", () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode")
			const abort = vi.fn()
			terminal.taskId = "task-idle"
			terminal.busy = false
			terminal.process = { abort } as any

			TerminalRegistry.releaseTerminalsForTask("task-idle")

			expect(abort).not.toHaveBeenCalled()
			expect(terminal.taskId).toBeUndefined()
		})

		it("only releases terminals belonging to the given task", () => {
			const a = TerminalRegistry.createTerminal("/a", "vscode")
			const b = TerminalRegistry.createTerminal("/b", "vscode")
			const abortA = vi.fn()
			const abortB = vi.fn()
			a.taskId = "task-A"
			a.busy = true
			a.process = { abort: abortA } as any
			b.taskId = "task-B"
			b.busy = true
			b.process = { abort: abortB } as any

			TerminalRegistry.releaseTerminalsForTask("task-A")

			expect(abortA).toHaveBeenCalledTimes(1)
			expect(a.taskId).toBeUndefined()
			expect(abortB).not.toHaveBeenCalled()
			expect(b.taskId).toBe("task-B")
		})

		it("swallows errors thrown by process.abort() and still disassociates the terminal", () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode")
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			terminal.taskId = "task-throw"
			terminal.busy = true
			terminal.process = {
				abort: vi.fn(() => {
					throw new Error("boom")
				}),
			} as any

			expect(() => TerminalRegistry.releaseTerminalsForTask("task-throw")).not.toThrow()
			expect(terminal.taskId).toBeUndefined()
			consoleErrorSpy.mockRestore()
		})
	})
})
