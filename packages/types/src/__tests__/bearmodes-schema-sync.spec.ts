import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

import { generateBearmodesJsonSchema } from "../bearmodes-schema.js"

/**
 * This test verifies that the checked-in schemas/bearmodes.json matches what
 * would be generated from the current Zod schemas. If this test fails, run:
 *
 *   pnpm --filter @bear-code/types generate:schema
 *
 * to regenerate the schema file.
 */
describe("bearmodes schema sync", () => {
	it("should match the dynamically generated schema from Zod types", () => {
		const __dirname = path.dirname(fileURLToPath(import.meta.url))
		const schemaPath = path.resolve(__dirname, "../../../../schemas/bearmodes.json")
		const checkedIn = JSON.parse(fs.readFileSync(schemaPath, "utf-8"))

		const generated = generateBearmodesJsonSchema()

		expect(checkedIn).toEqual(generated)
	})
})
