import type { SubmittedScore } from "../domain/scoring";

export interface ConfirmGameCommand {
	requesterUserId: string;
	idempotencyKey: string;
	scores: SubmittedScore[];
}

export class GameCommandInputError extends Error {
	constructor() {
		super("Game result input is invalid.");
		this.name = "GameCommandInputError";
	}
}

export function validateConfirmGameCommand(input: ConfirmGameCommand): void {
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) {
		throw new GameCommandInputError();
	}

	if (!Array.isArray(input.scores) || input.scores.length < 3 || input.scores.length > 4) {
		throw new GameCommandInputError();
	}

	if (
		input.scores.some(
			(score) =>
				typeof score.userId !== "string" ||
				score.userId.length === 0 ||
				score.userId.length > 64 ||
				!Number.isSafeInteger(score.finalScore),
		)
	) {
		throw new GameCommandInputError();
	}
}

/** A stable representation used to reject an idempotency-key reuse with different data. */
export function fingerprintConfirmGameCommand(input: ConfirmGameCommand): string {
	return JSON.stringify({
		requesterUserId: input.requesterUserId,
		scores: [...input.scores].sort(
			(left, right) => left.userId.localeCompare(right.userId),
		),
	});
}
