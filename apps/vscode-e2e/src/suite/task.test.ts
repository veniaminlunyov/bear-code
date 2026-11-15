import * as assert from "assert"

import { BearCodeEventName, type ClineMessage } from "@bear-code/types"

import { waitUntilCompleted } from "./utils"
import { setDefaultSuiteTimeout } from "./test-utils"

suite("BearCode Task", function () {
	setDefaultSuiteTimeout(this)

	test("Should handle prompt and response correctly", async () => {
		const api = globalThis.api

		const messages: ClineMessage[] = []

		api.on(BearCodeEventName.Message, ({ message }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const taskId = await api.startNewTask({
			configuration: { mode: "ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Hello world, what is your name? Respond with 'My name is ...'",
		})

		await waitUntilCompleted({ api, taskId })

		assert.ok(
			!!messages.find(
				({ say, text }) => (say === "completion_result" || say === "text") && text?.includes("My name is Bear"),
			),
			`Completion should include "My name is Bear"`,
		)
	})
})
