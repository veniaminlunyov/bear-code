import { parseFrontmatter } from "../frontmatter"

describe("parseFrontmatter", () => {
	afterEach(() => {
		delete (globalThis as Record<string, unknown>).__bearFrontmatterPwned
	})

	it("parses YAML frontmatter", () => {
		const result = parseFrontmatter("---\ndescription: Hello\n---\nBody")
		expect(result.data).toEqual({ description: "Hello" })
		expect(result.content.trim()).toBe("Body")
	})

	it("parses explicit yaml and json frontmatter", () => {
		expect(parseFrontmatter("---yaml\na: 1\n---\nx").data).toEqual({ a: 1 })
		expect(parseFrontmatter('---json\n{"a": 1}\n---\nx').data).toEqual({ a: 1 })
	})

	it("returns content unchanged when there is no frontmatter", () => {
		const result = parseFrontmatter("Just text")
		expect(result.data).toEqual({})
		expect(result.content).toBe("Just text")
	})

	it.each(["js", "javascript", "JS", "coffee"])("refuses to execute ---%s frontmatter", (language) => {
		const content = `---${language}\n(globalThis.__bearFrontmatterPwned = true, { description: "x" })\n---\nBody`
		expect(() => parseFrontmatter(content)).toThrow()
		expect((globalThis as Record<string, unknown>).__bearFrontmatterPwned).toBeUndefined()
	})

	it("refuses executable frontmatter behind a BOM", () => {
		const content = `\uFEFF---js\n(globalThis.__bearFrontmatterPwned = true, {})\n---\nBody`
		expect(() => parseFrontmatter(content)).toThrow()
		expect((globalThis as Record<string, unknown>).__bearFrontmatterPwned).toBeUndefined()
	})
})
