import matter from "gray-matter"

/** Frontmatter languages that are parsed as data and never executed. */
const SAFE_FRONTMATTER_LANGUAGES = new Set(["yaml", "yml", "json"])

const rejectExecutableEngine = (): never => {
	throw new Error("Executable frontmatter engines are disabled")
}

/**
 * Parses Markdown frontmatter without executing code.
 *
 * gray-matter selects the parser from the opening delimiter, and its built-in
 * `---js` / `---javascript` engine evaluates the block with `eval`. Command and
 * skill files come from the workspace, so a cloned repository could otherwise
 * run arbitrary code inside the extension host just by being opened.
 */
export function parseFrontmatter(content: string): matter.GrayMatterFile<string> {
	// gray-matter strips a leading BOM before detecting the opening delimiter.
	const input = content.replace(/^\uFEFF/, "")

	if (matter.test(input)) {
		const { name: language } = matter.language(input)
		if (language && !SAFE_FRONTMATTER_LANGUAGES.has(language.trim().toLowerCase())) {
			throw new Error(`Unsupported frontmatter language: ${language}`)
		}
	}

	// Defense in depth: even if language detection above is bypassed, the
	// executable engines are replaced with ones that refuse to run.
	return matter(content, {
		engines: {
			javascript: { parse: rejectExecutableEngine, stringify: rejectExecutableEngine },
			js: { parse: rejectExecutableEngine, stringify: rejectExecutableEngine },
			coffee: { parse: rejectExecutableEngine, stringify: rejectExecutableEngine },
			coffeescript: { parse: rejectExecutableEngine, stringify: rejectExecutableEngine },
			cson: { parse: rejectExecutableEngine, stringify: rejectExecutableEngine },
		},
	})
}
