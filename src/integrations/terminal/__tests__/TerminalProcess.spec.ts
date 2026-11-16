// npx vitest run src/integrations/terminal/__tests__/TerminalProcess.spec.ts

import * as vscode from "vscode"

import { mergePromise } from "../mergePromise"
import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

class TestTerminalProcess extends TerminalProcess {
	public callTrimRetrievedOutput(): void {
		this.trimRetrievedOutput()
	}
}

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalProcess", () => {
	let terminalProcess: TestTerminalProcess
	let mockTerminal: any
	type TestVscodeTerminal = vscode.Terminal & {
		shellIntegration: {
			executeCommand: any
		}
	}
	let mockTerminalInfo: Terminal
	let mockExecution: any
	let mockStream: AsyncIterableIterator<string>

	beforeEach(() => {
		// Create properly typed mock terminal
		mockTerminal = {
			shellIntegration: {
				executeCommand: vi.fn(),
			},
			name: "BearCode",
			processId: Promise.resolve(123),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: true },
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		} as unknown as TestVscodeTerminal

		mockTerminalInfo = new Terminal(1, mockTerminal, "./")

		// Create a process for testing
		terminalProcess = new TestTerminalProcess(mockTerminalInfo)

		TerminalRegistry["terminals"].push(mockTerminalInfo)

		// Reset event listeners
		terminalProcess.removeAllListeners()
	})

	describe("run", () => {
		it("rejects the command promise when terminal process startup rejects", async () => {
			const startupError = new Error("terminal startup failed")
			const runSpy = vi.spyOn(TerminalProcess.prototype, "run").mockRejectedValueOnce(startupError)
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

			try {
				const commandPromise = mockTerminalInfo.runCommand("test command", {
					onLine: vi.fn(),
					onCompleted: vi.fn(),
					onShellExecutionStarted: vi.fn(),
					onShellExecutionComplete: vi.fn(),
				})

				await expect(commandPromise).rejects.toThrow("terminal startup failed")
				expect(runSpy).toHaveBeenCalledWith("test command")
			} finally {
				runSpy.mockRestore()
				consoleErrorSpy.mockRestore()
			}
		})

		it("handles shell integration commands correctly", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			// Mock stream data with shell integration sequences.
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "Initial output\n"
				yield "More output\n"
				yield "Final output"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)
			await runPromise

			expect(lines).toEqual(["Initial output", "More output", "Final output"])
			expect(terminalProcess.isHot).toBe(false)
		})

		it("handles terminals without shell integration", async () => {
			// Temporarily suppress the expected console.warn for this test
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Create a terminal without shell integration
			const noShellTerminal = {
				sendText: vi.fn(),
				shellIntegration: undefined,
				name: "No Shell Terminal",
				processId: Promise.resolve(456),
				creationOptions: {},
				exitStatus: undefined,
				state: { isInteractedWith: true },
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
			} as unknown as vscode.Terminal

			// Create new terminal info with the no-shell terminal
			const noShellTerminalInfo = new Terminal(2, noShellTerminal, "./")

			// Create new process with the no-shell terminal
			const noShellProcess = new TerminalProcess(noShellTerminalInfo)

			// Set up event listeners to verify events are emitted
			const eventPromises = Promise.all([
				new Promise<void>((resolve) =>
					noShellProcess.once("no_shell_integration", (_message: string) => resolve()),
				),
				new Promise<void>((resolve) => noShellProcess.once("completed", (_output?: string) => resolve())),
				new Promise<void>((resolve) => noShellProcess.once("continue", resolve)),
			])

			// Run command and wait for all events
			await noShellProcess.run("test command")
			await eventPromises

			// Verify sendText was called with the command
			expect(noShellTerminal.sendText).toHaveBeenCalledWith("test command", true)

			// Restore the original console.warn
			consoleWarnSpy.mockRestore()
		})

		it("sets hot state for compiling commands", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			const completePromise = new Promise<void>((resolve) => {
				terminalProcess.on("shell_execution_complete", () => resolve())
			})

			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "compiling...\n"
				yield "still compiling...\n"
				yield "done"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run("npm run build")
			terminalProcess.emit("stream_available", mockStream)

			expect(terminalProcess.isHot).toBe(true)
			await runPromise

			expect(lines).toEqual(["compiling...", "still compiling...", "done"])

			await completePromise
			expect(terminalProcess.isHot).toBe(false)
		})

		it("completes cleanly when shell execution completes before the stream arrives", async () => {
			vi.useFakeTimers()
			const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})

			try {
				const completedOutputs: string[] = []
				const continueSpy = vi.fn()
				const noShellIntegrationSpy = vi.fn()
				terminalProcess.on("completed", (output) => completedOutputs.push(output ?? ""))
				terminalProcess.on("continue", continueSpy)
				terminalProcess.on("no_shell_integration", noShellIntegrationSpy)
				mockTerminalInfo.busy = true

				// The end event beats the start event: completion is signalled after
				// run() registered its listeners but before any stream_available.
				setTimeout(() => terminalProcess.emit("shell_execution_complete", { exitCode: 0 }), 0)

				const runPromise = terminalProcess.run("true")
				await vi.advanceTimersByTimeAsync(0)
				await runPromise

				expect(completedOutputs).toEqual([""])
				expect(continueSpy).toHaveBeenCalledTimes(1)
				expect(terminalProcess.isHot).toBe(false)
				expect(mockTerminalInfo.busy).toBe(false)

				// The stream timeout must have been cancelled rather than firing later.
				await vi.advanceTimersByTimeAsync(Terminal.getShellIntegrationTimeout() + 1_000)
				expect(noShellIntegrationSpy).not.toHaveBeenCalled()
				expect(completedOutputs).toEqual([""])
			} finally {
				consoleInfoSpy.mockRestore()
				vi.useRealTimers()
			}
		})
	})

	describe("continue", () => {
		it("stops listening and emits continue event", () => {
			const continueSpy = vi.fn()
			terminalProcess.on("continue", continueSpy)

			terminalProcess.continue()

			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess["isListening"]).toBe(false)
		})
	})

	describe("abort", () => {
		// These mirror the private constants in TerminalProcess.ts
		// (ABORT_RETRY_DELAY_MS and CTRL_C_SEND_LIMIT); update both together.
		const RETRY_DELAY_MS = 500
		const MAX_ATTEMPTS = 3

		beforeEach(() => {
			vi.useFakeTimers()
			// abort() runs against the terminal's current process; mirror that wiring
			// so the reuse guard (terminal.process === this) lets the retry proceed.
			mockTerminalInfo.process = terminalProcess
		})

		afterEach(() => {
			vi.runOnlyPendingTimers()
			vi.useRealTimers()
		})

		it("sends a single Ctrl+C when the process exits right away", async () => {
			mockTerminalInfo.busy = false

			terminalProcess.abort()

			expect(mockTerminal.sendText).toHaveBeenCalledTimes(1)
			expect(mockTerminal.sendText).toHaveBeenCalledWith("\x03")

			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_ATTEMPTS)
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(1)
		})

		it("re-sends Ctrl+C up to the bounded maximum while the process stays busy", async () => {
			mockTerminalInfo.busy = true

			terminalProcess.abort()
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(1)

			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * (MAX_ATTEMPTS + 2))

			expect(mockTerminal.sendText).toHaveBeenCalledTimes(MAX_ATTEMPTS)
			expect(mockTerminal.sendText).toHaveBeenCalledWith("\x03")
		})

		it("stops re-sending Ctrl+C once the process exits mid-retry", async () => {
			mockTerminalInfo.busy = true

			terminalProcess.abort()
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2)

			// Drive the real completion path (clears busy and terminal.process).
			mockTerminalInfo.shellExecutionComplete({ exitCode: 0 })
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_ATTEMPTS)

			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2)
		})

		it("stops re-sending Ctrl+C if the terminal is reused for a different process", async () => {
			mockTerminalInfo.busy = true

			terminalProcess.abort()
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2)

			// The terminal is now running a new command; it must not be interrupted.
			mockTerminalInfo.process = new TestTerminalProcess(mockTerminalInfo)
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_ATTEMPTS)

			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2)
		})

		it("does nothing when the process is no longer listening", async () => {
			terminalProcess["isListening"] = false

			terminalProcess.abort()
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_ATTEMPTS)

			expect(mockTerminal.sendText).not.toHaveBeenCalled()
		})

		it("does not start overlapping retry loops when abort() is called repeatedly", async () => {
			mockTerminalInfo.busy = true

			terminalProcess.abort()
			terminalProcess.abort()

			// Each call sends its own immediate Ctrl+C, but only one retry loop runs.
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2)

			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * (MAX_ATTEMPTS + 2))

			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2 + (MAX_ATTEMPTS - 1))
		})
	})

	describe("getUnretrievedOutput", () => {
		it("returns and clears unretrieved output", () => {
			terminalProcess["fullOutput"] = `\x1b]633;C\x07previous\nnew output\x1b]633;D\x07`
			terminalProcess["lastRetrievedIndex"] = 17 // After "previous\n"

			const unretrieved = terminalProcess.getUnretrievedOutput()
			expect(unretrieved).toBe("new output")

			expect(terminalProcess["lastRetrievedIndex"]).toBe(terminalProcess["fullOutput"].length - "previous".length)
		})
	})

	describe("interpretExitCode", () => {
		it("handles undefined exit code", () => {
			const result = TerminalProcess.interpretExitCode(undefined)
			expect(result).toEqual({ exitCode: undefined })
		})

		it("handles normal exit codes (0-128)", () => {
			const result = TerminalProcess.interpretExitCode(0)
			expect(result).toEqual({ exitCode: 0 })

			const result2 = TerminalProcess.interpretExitCode(1)
			expect(result2).toEqual({ exitCode: 1 })

			const result3 = TerminalProcess.interpretExitCode(128)
			expect(result3).toEqual({ exitCode: 128 })
		})

		it("interprets signal exit codes (>128)", () => {
			// SIGTERM (15) -> 128 + 15 = 143
			const result = TerminalProcess.interpretExitCode(143)
			expect(result).toEqual({
				exitCode: 143,
				signal: 15,
				signalName: "SIGTERM",
				coreDumpPossible: false,
			})

			// SIGSEGV (11) -> 128 + 11 = 139
			const result2 = TerminalProcess.interpretExitCode(139)
			expect(result2).toEqual({
				exitCode: 139,
				signal: 11,
				signalName: "SIGSEGV",
				coreDumpPossible: true,
			})
		})

		it("handles unknown signals", () => {
			const result = TerminalProcess.interpretExitCode(255)
			expect(result).toEqual({
				exitCode: 255,
				signal: 127,
				signalName: "Unknown Signal (127)",
				coreDumpPossible: false,
			})
		})
	})

	describe("trimRetrievedOutput", () => {
		it("clears buffer when all output has been retrieved", () => {
			// Set up a scenario where all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 16 // Same as fullOutput.length

			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("does not clear buffer when there is unretrieved output", () => {
			// Set up a scenario where not all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 5 // Less than fullOutput.length
			terminalProcess.callTrimRetrievedOutput()

			// Buffer should NOT be cleared - there's still unretrieved content
			expect(terminalProcess["fullOutput"]).toBe("test output data")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(5)
		})

		it("does nothing when buffer is already empty", () => {
			terminalProcess["fullOutput"] = ""
			terminalProcess["lastRetrievedIndex"] = 0
			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("clears buffer when lastRetrievedIndex exceeds fullOutput length", () => {
			// Edge case: index is greater than current length (could happen if output was modified)
			terminalProcess["fullOutput"] = "short"
			terminalProcess["lastRetrievedIndex"] = 100
			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})
	})

	describe("mergePromise", () => {
		it("merges promise methods with terminal process", async () => {
			const process = new TerminalProcess(mockTerminalInfo)
			const promise = Promise.resolve()

			const merged = mergePromise(process, promise)

			expect(merged).toHaveProperty("then")
			expect(merged).toHaveProperty("catch")
			expect(merged).toHaveProperty("finally")
			expect(merged instanceof TerminalProcess).toBe(true)

			await expect(merged).resolves.toBeUndefined()
		})
	})
})
