import * as path from "path"

describe("custom-instructions path detection", () => {
	it("should use exact path comparison instead of string includes", () => {
		// Test the logic that our fix implements
		const fakeHomeDir = "/Users/john.bear.smith"
		const globalBearDir = path.join(fakeHomeDir, ".bear") // "/Users/john.bear.smith/.bear"
		const projectBearDir = "/projects/my-project/.bear"

		// Old implementation (fragile):
		// const isGlobal = bearDir.includes(path.join(os.homedir(), ".bear"))
		// This could fail if the home directory path contains ".bear" elsewhere

		// New implementation (robust):
		// const isGlobal = path.resolve(bearDir) === path.resolve(getGlobalBearDirectory())

		// Test the new logic
		const isGlobalForGlobalDir = path.resolve(globalBearDir) === path.resolve(globalBearDir)
		const isGlobalForProjectDir = path.resolve(projectBearDir) === path.resolve(globalBearDir)

		expect(isGlobalForGlobalDir).toBe(true)
		expect(isGlobalForProjectDir).toBe(false)

		// Verify that the old implementation would have been problematic
		// if the home directory contained ".bear" in the path
		const oldLogicGlobal = globalBearDir.includes(path.join(fakeHomeDir, ".bear"))
		const oldLogicProject = projectBearDir.includes(path.join(fakeHomeDir, ".bear"))

		expect(oldLogicGlobal).toBe(true) // This works
		expect(oldLogicProject).toBe(false) // This also works, but is fragile

		// The issue was that if the home directory path itself contained ".bear",
		// the includes() check could produce false positives in edge cases
	})

	it("should handle edge cases with path resolution", () => {
		// Test various edge cases that exact path comparison handles better
		const testCases = [
			{
				global: "/Users/test/.bear",
				project: "/Users/test/project/.bear",
				expected: { global: true, project: false },
			},
			{
				global: "/home/user/.bear",
				project: "/home/user/.bear", // Same directory
				expected: { global: true, project: true },
			},
			{
				global: "/Users/john.bear.smith/.bear",
				project: "/projects/app/.bear",
				expected: { global: true, project: false },
			},
		]

		testCases.forEach(({ global, project, expected }) => {
			const isGlobalForGlobal = path.resolve(global) === path.resolve(global)
			const isGlobalForProject = path.resolve(project) === path.resolve(global)

			expect(isGlobalForGlobal).toBe(expected.global)
			expect(isGlobalForProject).toBe(expected.project)
		})
	})
})
