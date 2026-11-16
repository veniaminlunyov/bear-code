//
// Tests the ExecuteCommand tool itself vs calling the tool where the tool is mocked.
//
import * as path from "path"
import * as fs from "fs/promises"

import { ExecuteCommandOptions } from "../ExecuteCommandTool"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { ExecaTerminal } from "../../../integrations/terminal/ExecaTerminal"
import type { BearTerminalCallbacks } from "../../../integrations/terminal/types"

// Mock fs to control directory existence checks
vitest.mock("fs/promises")

// Mock TerminalRegistry to control terminal creation
vitest.mock("../../../integrations/terminal/TerminalRegistry")

// Mock Terminal and ExecaTerminal classes
vitest.mock("../../../integrations/terminal/Terminal")
vitest.mock("../../../integrations/terminal/ExecaTerminal")

// Mock persisted output handling (only used when the provider exposes storage)
vitest.mock("../../../integrations/terminal/OutputInterceptor")
vitest.mock("../../../utils/storage")

import { OutputInterceptor } from "../../../integrations/terminal/OutputInterceptor"
import { getTaskDirectoryPath } from "../../../utils/storage"

// Import the actual executeCommand function (not mocked)
import { COMMAND_OUTPUT_ASK_DELAY_MS, executeCommandInTerminal } from "../ExecuteCommandTool"

// Tests for the executeCommand function
describe("executeCommand", () => {
	let mockTask: any
	let mockTerminal: any
	let mockProcess: any
	let mockProvider: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock fs.access to simulate directory existence
		;(fs.access as any).mockResolvedValue(undefined)

		// Create mock provider
		mockProvider = {
			postMessageToWebview: vitest.fn(),
			getState: vitest.fn().mockResolvedValue({
				terminalShellIntegrationDisabled: false,
			}),
		}

		// Create mock task
		mockTask = {
			cwd: "/test/project",
			taskId: "test-task-123",
			providerRef: {
				deref: vitest.fn().mockResolvedValue(mockProvider),
			},
			say: vitest.fn().mockResolvedValue(undefined),
			terminalProcess: undefined,
		}

		// Create mock process that resolves immediately
		mockProcess = Promise.resolve()
		mockProcess.continue = vitest.fn()

		// Create mock terminal with getCurrentWorkingDirectory method
		mockTerminal = {
			provider: "vscode",
			id: 1,
			initialCwd: "/test/project",
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/project"),
			runCommand: vitest.fn().mockReturnValue(mockProcess),
			terminal: {
				show: vitest.fn(),
			},
		}

		// Mock TerminalRegistry.getOrCreateTerminal
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)
	})

	describe("Working Directory Behavior", () => {
		it("should use terminal.getCurrentWorkingDirectory() in the output message for completed commands", async () => {
			// Setup: Mock terminal to return a different current working directory
			const initialCwd = "/test/project"
			const currentCwd = "/test/project/subdirectory"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(currentCwd)

			// Mock the terminal process to complete successfully
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				// Simulate command completion
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain(`within working directory '${currentCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)
		})

		it("should use terminal.getCurrentWorkingDirectory() for VSCode Terminal with shell integration", async () => {
			// Setup: Mock VSCode Terminal instance
			const vscodeTerminal = new Terminal(1, undefined, "/test/project")
			const mockVSCodeTerminal = vscodeTerminal as any

			// Mock shell integration providing different cwd
			mockVSCodeTerminal.terminal = {
				show: vitest.fn(),
				shellIntegration: {
					cwd: { fsPath: "/test/project/changed-dir" },
				},
			}
			mockVSCodeTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project/changed-dir")
			mockVSCodeTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockVSCodeTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("within working directory '/test/project/changed-dir'")
		})

		it("should use terminal.getCurrentWorkingDirectory() for ExecaTerminal (always returns initialCwd)", async () => {
			// Setup: Mock ExecaTerminal instance
			const execaTerminal = new ExecaTerminal(1, "/test/project")
			const mockExecaTerminal = execaTerminal as any

			// ExecaTerminal always returns initialCwd
			mockExecaTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project")
			mockExecaTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockExecaTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true, // Forces ExecaTerminal
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockExecaTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Custom Working Directory", () => {
		it("should handle absolute custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const customCwd = "/custom/absolute/path"

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(customCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(customCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`within working directory '${customCwd}'`)
		})

		it("should handle relative custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const relativeCwd = "subdirectory"
			const resolvedCwd = path.resolve(mockTask.cwd, relativeCwd)

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(resolvedCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: relativeCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(resolvedCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`within working directory '${resolvedCwd.toPosix()}'`)
		})

		it("should return error when custom working directory does not exist", async () => {
			const nonExistentCwd = "/non/existent/path"

			// Mock fs.access to throw error for non-existent directory
			;(fs.access as any).mockRejectedValue(new Error("Directory does not exist"))

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: nonExistentCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toBe(`Working directory '${nonExistentCwd}' does not exist.`)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})
	})

	describe("Terminal Provider Selection", () => {
		it("should use vscode provider when shell integration is enabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "vscode")
		})

		it("should use execa provider when shell integration is disabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "execa")
		})
	})

	describe("Command Execution States", () => {
		it("should handle completed command with exit code 0", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command completed successfully", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo success",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 0")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("should handle completed command with non-zero exit code", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command failed", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "exit 1",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Command execution was not successful")
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("should handle command terminated by signal", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command interrupted", mockProcess)
					callbacks.onShellExecutionComplete(
						{
							exitCode: undefined,
							signalName: "SIGINT",
							coreDumpPossible: false,
						},
						mockProcess,
					)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "long-running-command",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Process terminated by signal SIGINT")
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Completion without exit details", () => {
		it("waits for onCompleted instead of reporting a finished command as still running", async () => {
			// The final command_output say is slower than the tool's 50ms settle delay.
			mockTask.say = vitest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 150)))

			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				// e.g. the shell integration stream timed out: "completed" is emitted
				// but there is no shell_execution_complete, so no exit details.
				setTimeout(() => callbacks.onCompleted("partial output", mockProcess), 0)
				return mockProcess
			})

			const [rejected, result] = await executeCommandInTerminal(mockTask, {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			})

			expect(rejected).toBe(false)
			expect(result).toContain("Command executed in terminal")
			expect(result).not.toContain("still running")
		})

		it("reports the command as finished even if finalizing persisted output fails", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			mockProvider.context = { globalStorageUri: { fsPath: "/test/storage" } }
			vitest.mocked(getTaskDirectoryPath).mockResolvedValue("/test/storage/tasks/test-task-123")
			vitest.mocked(OutputInterceptor).mockImplementation(
				() =>
					({
						write: vitest.fn(),
						finalize: vitest.fn().mockRejectedValue(new Error("disk full")),
					}) as any,
			)

			mockTerminal.runCommand.mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const [rejected, result] = await executeCommandInTerminal(mockTask, {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			})

			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 0")
			expect(result).not.toContain("still running")
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				"[ExecuteCommandTool] interceptor.finalize() failed:",
				expect.any(Error),
			)
			consoleErrorSpy.mockRestore()
		})

		it("does not wait for completion when the process was moved to the background", async () => {
			// The process resolves via continue() (e.g. "Proceed While Running") and
			// onCompleted never fires while the tool is still running.
			mockTerminal.runCommand.mockReturnValue(mockProcess)

			const [rejected, result] = await executeCommandInTerminal(mockTask, {
				executionId: "test-123",
				command: "npm run dev",
				terminalShellIntegrationDisabled: false,
			})

			expect(rejected).toBe(false)
			expect(result).toContain("still running")
		})
	})

	describe("command_output ask", () => {
		type ControllableProcess = Promise<void> & { continue: any; abort: any }

		let callbacks: BearTerminalCallbacks | undefined
		let proc: ControllableProcess
		let resolveProcess: () => void

		const options: ExecuteCommandOptions = {
			executionId: "test-123",
			command: "npm run build",
			terminalShellIntegrationDisabled: false,
		}

		beforeEach(() => {
			vitest.useFakeTimers()
			callbacks = undefined

			const processPromise = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})

			proc = Object.assign(processPromise, {
				continue: vitest.fn(() => resolveProcess()),
				abort: vitest.fn(),
			})

			mockTask.ask = vitest.fn().mockResolvedValue({ response: "yesButtonClicked" })
			mockTask.supersedePendingAsk = vitest.fn()

			mockTerminal.runCommand.mockImplementation((_command: string, cbs: BearTerminalCallbacks) => {
				callbacks = cbs
				return proc
			})
		})

		afterEach(() => {
			vitest.useRealTimers()
		})

		// Returns the tool promise wrapped in an object so awaiting start() waits
		// for the callbacks to be wired up, not for the tool to finish.
		const start = async (opts: ExecuteCommandOptions = options) => {
			const promise = executeCommandInTerminal(mockTask, opts)
			await vitest.waitFor(() => expect(callbacks).toBeDefined())
			return { promise }
		}

		const complete = async (output: string) => {
			await callbacks!.onCompleted(output, proc as any)
			callbacks!.onShellExecutionComplete({ exitCode: 0 }, proc as any)
			resolveProcess()
			await vitest.advanceTimersByTimeAsync(100)
		}

		it("does not ask when a short command emits output and finishes within the grace period", async () => {
			const { promise: toolPromise } = await start()

			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("hello\n", proc as any)
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS - 1_000)
			await complete("hello\n")

			// Well past the original deadline: the cancelled ask must never fire.
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS * 2)

			const [, result] = await toolPromise
			expect(mockTask.ask).not.toHaveBeenCalled()
			expect(result).toContain("Exit code: 0")
		})

		it("asks once the command is still running after the grace period", async () => {
			const { promise: toolPromise } = await start()

			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("compiling...\n", proc as any)
			await callbacks!.onLine("still compiling...\n", proc as any)

			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS - 1)
			expect(mockTask.ask).not.toHaveBeenCalled()

			await vitest.advanceTimersByTimeAsync(1)
			expect(mockTask.ask).toHaveBeenCalledTimes(1)
			expect(mockTask.ask).toHaveBeenCalledWith("command_output", "")

			await complete("done\n")
			await toolPromise
		})

		it("keeps waiting for the command when the auto-approved ask resolves", async () => {
			// command_output is a non-blocking ask that is approved immediately; that
			// answer must not hand control back to the model mid-command.
			const { promise: toolPromise } = await start()
			let toolResolved = false
			void toolPromise.then(() => {
				toolResolved = true
			})

			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("server starting...\n", proc as any)
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS + 1_000)

			expect(mockTask.ask).toHaveBeenCalledTimes(1)
			expect(proc.continue).not.toHaveBeenCalled()
			expect(toolResolved).toBe(false)

			await complete("server stopped\n")

			const [, result] = await toolPromise
			expect(result).toContain("Exit code: 0")
			expect(result).toContain("Command executed in terminal")
		})

		it("anchors the grace period to the shell execution start", async () => {
			const { promise: toolPromise } = await start()

			// Shell integration takes a while on a cold terminal.
			await vitest.advanceTimersByTimeAsync(3_000)
			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("output\n", proc as any)

			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS - 1)
			expect(mockTask.ask).not.toHaveBeenCalled()

			await vitest.advanceTimersByTimeAsync(1)
			expect(mockTask.ask).toHaveBeenCalledTimes(1)

			await complete("output\n")
			await toolPromise
		})

		it("reschedules a pending ask when output arrives before the start event", async () => {
			const { promise: toolPromise } = await start()

			await vitest.advanceTimersByTimeAsync(3_000)
			await callbacks!.onLine("early output\n", proc as any)
			await vitest.advanceTimersByTimeAsync(1_000)
			callbacks!.onShellExecutionStarted(1234, proc as any)

			// The original deadline (runCommand + grace period) passes without an ask.
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS - 4_000)
			expect(mockTask.ask).not.toHaveBeenCalled()

			// The re-anchored deadline fires it.
			await vitest.advanceTimersByTimeAsync(4_000)
			expect(mockTask.ask).toHaveBeenCalledTimes(1)

			await complete("done\n")
			await toolPromise
		})

		it("continues the process and returns the user's message on a typed response", async () => {
			mockTask.ask = vitest.fn().mockResolvedValue({ response: "messageResponse", text: "check the logs" })
			const { promise: toolPromise } = await start()

			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("server starting...\n", proc as any)
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS)
			await vitest.advanceTimersByTimeAsync(100)

			const [, result] = await toolPromise
			expect(proc.continue).toHaveBeenCalled()
			expect(mockTask.say).toHaveBeenCalledWith("user_feedback", "check the logs", undefined)
			expect(result).toContain("Command is still running")
		})

		it("cancels a pending ask when the agent timeout moves the command to the background", async () => {
			const { promise: toolPromise } = await start({ ...options, agentTimeout: 2_000 })

			callbacks!.onShellExecutionStarted(1234, proc as any)
			await callbacks!.onLine("server starting...\n", proc as any)

			await vitest.advanceTimersByTimeAsync(2_000)
			expect(proc.continue).toHaveBeenCalled()
			expect(mockTask.supersedePendingAsk).toHaveBeenCalled()

			await vitest.advanceTimersByTimeAsync(100)
			const [, result] = await toolPromise
			expect(result).toContain("Command is still running")

			// Output keeps arriving in the background; no ask may fire into a later step.
			await callbacks!.onLine("listening...\n", proc as any)
			await vitest.advanceTimersByTimeAsync(COMMAND_OUTPUT_ASK_DELAY_MS * 2)
			expect(mockTask.ask).not.toHaveBeenCalled()
		})
	})

	describe("Terminal Working Directory Updates", () => {
		it("should update working directory when terminal returns different cwd", async () => {
			// Setup: Terminal initially at project root, but getCurrentWorkingDirectory returns different path
			const initialCwd = "/test/project"
			const updatedCwd = "/test/project/src"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd

			// Mock Terminal instance behavior
			const mockTerminalInstance = {
				...mockTerminal,
				terminal: { show: vitest.fn() },
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue(updatedCwd),
				runCommand: vitest.fn().mockImplementation((command: string, callbacks: BearTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Directory changed", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				}),
			}

			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminalInstance)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "cd src && pwd",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify the result uses the updated working directory
			expect(rejected).toBe(false)
			expect(result).toContain(`within working directory '${updatedCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)

			// Verify the terminal's getCurrentWorkingDirectory was called
			expect(mockTerminalInstance.getCurrentWorkingDirectory).toHaveBeenCalled()
		})
	})
})
