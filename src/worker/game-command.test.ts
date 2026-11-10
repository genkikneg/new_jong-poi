import { describe, expect, it } from "vitest";
import {
	fingerprintConfirmGameCommand,
	GameCommandInputError,
	validateConfirmGameCommand,
} from "./game-command";

const command = {
	requesterUserId: "user-1",
	idempotencyKey: "result-command-0001",
	scores: [
		{ userId: "a", finalScore: 30_000 },
		{ userId: "b", finalScore: 25_000 },
		{ userId: "c", finalScore: 20_000 },
	],
};

describe("validateConfirmGameCommand", () => {
	it("accepts an integer score command with a sufficiently unique key", () => {
		expect(() => validateConfirmGameCommand(command)).not.toThrow();
	});

	it("rejects decimal scores and short idempotency keys", () => {
		expect(() =>
			validateConfirmGameCommand({
				...command,
				idempotencyKey: "too-short",
				scores: [{ userId: "a", finalScore: 1.5 }, ...command.scores.slice(1)],
			}),
		).toThrow(GameCommandInputError);
	});
});

describe("fingerprintConfirmGameCommand", () => {
	it("does not depend on the submitted score order", () => {
		expect(fingerprintConfirmGameCommand(command)).toBe(
			fingerprintConfirmGameCommand({
				...command,
				scores: [...command.scores].reverse(),
			}),
		);
	});
});
