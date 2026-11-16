import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

/**
 * Checks if a file path is outside all workspace folders
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string): boolean {
	// If there are no workspace folders, consider everything outside workspace for safety
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	// Normalize and resolve the path to handle .. and . components correctly
	const absolutePath = path.resolve(filePath)

	// Check if the path is within any workspace folder
	return !vscode.workspace.workspaceFolders.some((folder) => {
		const folderPath = folder.uri.fsPath
		// Path is inside a workspace if it equals the workspace path or is a subfolder
		return absolutePath === folderPath || absolutePath.startsWith(folderPath + path.sep)
	})
}

/**
 * Percent-decodes an untrusted path until it stops changing.
 *
 * Markdown link targets are URL syntax, and openFile decodes the path again
 * after validation. Decoding to a fixed point at the containment boundary
 * stops `%2e%2e/%2e%2e/.env` (or the double-encoded `%252e%252e`) from passing
 * the check as a literal and escaping after the later decode.
 *
 * A bare `%` that is not a valid escape (e.g. `report 50%.md`) leaves the value
 * unchanged, matching openFile. A value that never stabilizes within
 * `maxIterations` is treated as hostile and rejected with `null`.
 */
export function decodeUntrustedPathToStable(filePath: string, maxIterations = 8): string | null {
	let current = filePath
	for (let i = 0; i < maxIterations; i++) {
		let decoded: string
		try {
			decoded = decodeURIComponent(current)
		} catch {
			return current
		}
		if (decoded === current) {
			return current
		}
		current = decoded
	}
	return null
}

/**
 * Realpath of the deepest existing ancestor of `filePath` (the path itself
 * when it exists), or `null` when containment must fail closed: a dangling
 * symlink (a creation flow would follow it out of the workspace) or any
 * unexpected filesystem error.
 */
async function realPathOfExistingAncestor(filePath: string): Promise<string | null> {
	let current = filePath
	for (;;) {
		try {
			return await fs.promises.realpath(current)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				return null
			}
			// ENOENT is ambiguous: the entry may not exist yet, or it may be a
			// symlink whose target is missing. lstat does not follow the link.
			try {
				if ((await fs.promises.lstat(current)).isSymbolicLink()) {
					return null
				}
			} catch (lstatError) {
				if ((lstatError as NodeJS.ErrnoException).code !== "ENOENT") {
					return null
				}
			}
			const parent = path.dirname(current)
			if (parent === current) {
				return null
			}
			current = parent
		}
	}
}

/**
 * Symlink-aware containment check for untrusted paths. Resolves the real
 * filesystem target (or its deepest existing ancestor for paths that do not
 * exist yet) and the real workspace folders before comparing, so a symlink
 * inside the workspace cannot point outside it. Fails closed: no workspace
 * folders or an unexpected filesystem error counts as outside.
 */
export async function isRealPathOutsideWorkspace(filePath: string): Promise<boolean> {
	const folders = vscode.workspace.workspaceFolders
	if (!folders || folders.length === 0) {
		return true
	}
	const target = await realPathOfExistingAncestor(path.resolve(filePath))
	if (!target) {
		return true
	}
	const realFolders: string[] = []
	for (const folder of folders) {
		const real = await realPathOfExistingAncestor(folder.uri.fsPath)
		if (real) {
			realFolders.push(real)
		}
	}
	if (realFolders.length === 0) {
		return true
	}
	return !realFolders.some((folderPath) => target === folderPath || target.startsWith(folderPath + path.sep))
}
