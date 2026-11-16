import EventEmitter from "events"

export type BearTerminalProvider = "vscode" | "execa"

export interface BearTerminal {
	provider: BearTerminalProvider
	id: number
	busy: boolean
	running: boolean
	taskId?: string
	process?: BearTerminalProcess
	getCurrentWorkingDirectory(): string
	isClosed: () => boolean
	runCommand: (command: string, callbacks: BearTerminalCallbacks) => BearTerminalProcessResultPromise
	setActiveStream(stream: AsyncIterable<string> | undefined, pid?: number): void
	shellExecutionComplete(exitDetails: ExitCodeDetails): void
	getProcessesWithOutput(): BearTerminalProcess[]
	getUnretrievedOutput(): string
	getLastCommand(): string
	cleanCompletedProcessQueue(): void
}

export interface BearTerminalCallbacks {
	onLine: (line: string, process: BearTerminalProcess) => void
	onCompleted: (output: string | undefined, process: BearTerminalProcess) => void | Promise<void>
	onShellExecutionStarted: (pid: number | undefined, process: BearTerminalProcess) => void
	onShellExecutionComplete: (details: ExitCodeDetails, process: BearTerminalProcess) => void
	onNoShellIntegration?: (message: string, process: BearTerminalProcess) => void
}

export interface BearTerminalProcess extends EventEmitter<BearTerminalProcessEvents> {
	command: string
	isHot: boolean
	/** True once the tool stopped waiting for the command ("Proceed While Running" or the agent timeout). */
	movedToBackground?: boolean
	run: (command: string) => Promise<void>
	continue: () => void
	abort: () => void
	hasUnretrievedOutput: () => boolean
	getUnretrievedOutput: () => string
	trimRetrievedOutput: () => void
}

export type BearTerminalProcessResultPromise = BearTerminalProcess & Promise<void>

export interface BearTerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [output?: string]
	stream_available: [stream: AsyncIterable<string>]
	shell_execution_started: [pid: number | undefined]
	shell_execution_complete: [exitDetails: ExitCodeDetails]
	error: [error: Error]
	no_shell_integration: [message: string]
}

export interface ExitCodeDetails {
	exitCode: number | undefined
	signal?: number | undefined
	signalName?: string
	coreDumpPossible?: boolean
}
