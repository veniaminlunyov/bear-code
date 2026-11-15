// npx vitest run __tests__/delegation-events.spec.ts

import { BearCodeEventName, bearCodeEventsSchema, taskEventSchema } from "@bear-code/types"

describe("delegation event schemas", () => {
	test("bearCodeEventsSchema validates tuples", () => {
		expect(() =>
			(bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegated].parse(["p", "c"]),
		).not.toThrow()
		expect(() =>
			(bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() =>
			(bearCodeEventsSchema.shape as any)[BearCodeEventName.TaskDelegationResumed].parse(["p"]),
		).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: BearCodeEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: BearCodeEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: BearCodeEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
