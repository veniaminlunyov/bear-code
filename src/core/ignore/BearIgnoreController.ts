import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"

import { IGNORE_FILENAME, LEGACY_IGNORE_FILENAME } from "../../services/bear-config"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .bearignore (legacy: .rooignore) files.
 */
export class BearIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	bearIgnoreContent: string | undefined
	/** File name of the active ignore file (.bearignore, or legacy .rooignore) */
	bearIgnoreFileName: string = IGNORE_FILENAME

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.bearIgnoreContent = undefined
		// Set up file watcher for .bearignore
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadBearIgnore()
	}

	/**
	 * Set up the file watcher for .bearignore changes
	 */
	private setupFileWatcher(): void {
		// Watch both the BearCode name and the legacy Roo Code name
		const bearignorePattern = new vscode.RelativePattern(this.cwd, `{${IGNORE_FILENAME},${LEGACY_IGNORE_FILENAME}}`)
		const fileWatcher = vscode.workspace.createFileSystemWatcher(bearignorePattern)

		// Watch for changes and updates
		this.disposables.push(
			fileWatcher.onDidChange(() => this.loadBearIgnore()),
			fileWatcher.onDidCreate(() => this.loadBearIgnore()),
			fileWatcher.onDidDelete(() => this.loadBearIgnore()),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Load custom patterns from .bearignore if it exists
	 */
	private async loadBearIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			// Prefer .bearignore, fall back to the legacy .rooignore
			let ignorePath = path.join(this.cwd, IGNORE_FILENAME)
			if (!(await fileExistsAtPath(ignorePath))) {
				ignorePath = path.join(this.cwd, LEGACY_IGNORE_FILENAME)
			}
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				this.bearIgnoreContent = content
				this.bearIgnoreFileName = path.basename(ignorePath)
				this.ignoreInstance.add(content)
				this.ignoreInstance.add([IGNORE_FILENAME, LEGACY_IGNORE_FILENAME])
			} else {
				this.bearIgnoreContent = undefined
				this.bearIgnoreFileName = IGNORE_FILENAME
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading .bearignore:", error)
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * Automatically resolves symlinks
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if .bearignore does not exist
		if (!this.bearIgnoreContent) {
			return true
		}
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Follow symlinks to get the real path
			let realPath: string
			try {
				realPath = fsSync.realpathSync(absolutePath)
			} catch {
				// If realpath fails (file doesn't exist, broken symlink, etc.),
				// use the original path
				realPath = absolutePath
			}

			// Convert real path to relative for .bearignore checking
			const relativePath = path.relative(this.cwd, realPath).toPosix()

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// Allow access to files outside cwd or on errors (backward compatibility)
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no .bearignore exists
		if (!this.bearIgnoreContent) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Get formatted instructions about the .bearignore file for the LLM
	 * @returns Formatted instructions or undefined if .bearignore doesn't exist
	 */
	getInstructions(): string | undefined {
		if (!this.bearIgnoreContent) {
			return undefined
		}

		const fileName = this.bearIgnoreFileName
		return `# ${fileName}\n\n(The following is provided by a root-level ${fileName} file where the user has specified files and directories that should not be accessed. When using list_files, you'll notice a ${LOCK_TEXT_SYMBOL} next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n${this.bearIgnoreContent}\n${fileName}`
	}
}
