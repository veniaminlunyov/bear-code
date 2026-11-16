// npx vitest run core/tools/__tests__/switchModeTool.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

import { switchModeTool } from "../SwitchModeTool"
import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"

const createBlock = (mode_slug: string, reason = "test"): ToolUse<"switch_mode"> =>
	({
		type: "tool_use",
		name: "switch_mode",
		params: { mode_slug, reason },
		nativeArgs: { mode_slug, reason },
		partial: false,
	}) as ToolUse<"switch_mode">

describe("SwitchModeTool - task-local mode", () => {
	let mockTask: any
	let mockCallbacks: any
	let handleModeSwitch: ReturnType<typeof vi.fn>

	beforeEach(() => {
		handleModeSwitch = vi.fn().mockResolvedValue(undefined)

		mockTask = {
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			getTaskMode: vi.fn().mockResolvedValue("code"),
			providerRef: {
				deref: () => ({
					// Shared provider state reflects another task (e.g. the delegating parent).
					getState: vi.fn().mockResolvedValue({ mode: "orchestrator", customModes: [] }),
					handleModeSwitch,
				}),
			},
		}

		mockCallbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
	})

	it("rejects switching to the task's current mode even when provider state differs", async () => {
		await switchModeTool.handle(mockTask as Task, createBlock("code"), mockCallbacks)

		expect(mockTask.getTaskMode).toHaveBeenCalled()
		expect(mockTask.recordToolError).toHaveBeenCalledWith("switch_mode")
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(expect.stringMatching(/^Already in .* mode\.$/))
		expect(mockCallbacks.askApproval).not.toHaveBeenCalled()
		expect(handleModeSwitch).not.toHaveBeenCalled()
	})

	it("allows switching to the provider's mode when the task runs in a different mode", async () => {
		await switchModeTool.handle(mockTask as Task, createBlock("orchestrator", "coordinate"), mockCallbacks)

		expect(mockCallbacks.askApproval).toHaveBeenCalled()
		expect(handleModeSwitch).toHaveBeenCalledWith("orchestrator")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Successfully switched from .*Code mode to .*Orchestrator mode because: coordinate\.$/,
			),
		)
	})
})
