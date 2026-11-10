export type PlayerCount = 3 | 4;

/**
 * Monetary-style values are deliberately represented as integers.
 * `pointsMilli` is a point multiplied by 1,000; for example, 20.000 points is 20_000.
 */
export interface ScoringRules {
	playerCount: PlayerCount;
	baseScore: number;
	scoreMultiplierBasisPoints: number;
	rankBonusesMilli: Readonly<Record<number, number>>;
}

export interface SubmittedScore {
	userId: string;
	finalScore: number;
}

export interface CalculatedGameResult extends SubmittedScore {
	rank: number;
	scoreDifference: number;
	scorePointsMilli: number;
	rankBonusMilli: number;
	pointsMilli: number;
}

export type ScoreValidationIssue =
	| "PLAYER_COUNT_MISMATCH"
	| "DUPLICATE_PLAYER"
	| "PLAYER_SET_MISMATCH"
	| "SCORE_TOTAL_MISMATCH"
	| "INVALID_INTEGER";

export class ScoringValidationError extends Error {
	readonly issues: readonly ScoreValidationIssue[];

	constructor(issues: readonly ScoreValidationIssue[]) {
		super("Submitted game scores are invalid.");
		this.name = "ScoringValidationError";
		this.issues = issues;
	}
}

function hasSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value);
}

function hasDuplicateUserIds(scores: readonly SubmittedScore[]): boolean {
	return new Set(scores.map(({ userId }) => userId)).size !== scores.length;
}

function hasMatchingPlayers(
	memberIds: readonly string[],
	scores: readonly SubmittedScore[],
): boolean {
	const expected = new Set(memberIds);
	const actual = new Set(scores.map(({ userId }) => userId));

	return (
		expected.size === memberIds.length &&
		actual.size === scores.length &&
		expected.size === actual.size &&
		[...expected].every((userId) => actual.has(userId))
	);
}

/**
 * Uses competition ranking: [30000, 25000, 25000, 20000] becomes [1, 2, 2, 4].
 */
export function calculateRanks(
	scores: readonly SubmittedScore[],
): ReadonlyMap<string, number> {
	const sorted = [...scores].sort(
		(left, right) =>
			right.finalScore - left.finalScore || left.userId.localeCompare(right.userId),
	);
	const ranks = new Map<string, number>();
	let previousScore: number | undefined;
	let rank = 1;

	sorted.forEach((score, index) => {
		if (previousScore !== undefined && score.finalScore !== previousScore) {
			rank = index + 1;
		}

		ranks.set(score.userId, rank);
		previousScore = score.finalScore;
	});

	return ranks;
}

export function validateSubmittedScores(
	rules: ScoringRules,
	memberIds: readonly string[],
	scores: readonly SubmittedScore[],
): ScoreValidationIssue[] {
	const issues = new Set<ScoreValidationIssue>();

	if (memberIds.length !== rules.playerCount || scores.length !== rules.playerCount) {
		issues.add("PLAYER_COUNT_MISMATCH");
	}

	if (hasDuplicateUserIds(scores)) {
		issues.add("DUPLICATE_PLAYER");
	}

	if (!hasMatchingPlayers(memberIds, scores)) {
		issues.add("PLAYER_SET_MISMATCH");
	}

	if (
		![
			rules.baseScore,
			rules.scoreMultiplierBasisPoints,
			...Object.values(rules.rankBonusesMilli),
			...scores.map(({ finalScore }) => finalScore),
		].every(hasSafeInteger)
	) {
		issues.add("INVALID_INTEGER");
	}

	const total = scores.reduce((sum, { finalScore }) => sum + finalScore, 0);
	if (!hasSafeInteger(total) || total !== rules.baseScore * rules.playerCount) {
		issues.add("SCORE_TOTAL_MISMATCH");
	}

	return [...issues];
}

export function calculateGameResults(
	rules: ScoringRules,
	memberIds: readonly string[],
	scores: readonly SubmittedScore[],
): CalculatedGameResult[] {
	const issues = validateSubmittedScores(rules, memberIds, scores);
	if (issues.length > 0) {
		throw new ScoringValidationError(issues);
	}

	const ranks = calculateRanks(scores);

	return scores.map((score) => {
		const rank = ranks.get(score.userId);
		if (rank === undefined) {
			throw new Error("Rank calculation did not return a submitted user.");
		}

		const scoreDifference = score.finalScore - rules.baseScore;
		const scorePointsMilli = Math.trunc(
			(scoreDifference * rules.scoreMultiplierBasisPoints) / 10,
		);
		const rankBonusMilli = rules.rankBonusesMilli[rank] ?? 0;

		return {
			...score,
			rank,
			scoreDifference,
			scorePointsMilli,
			rankBonusMilli,
			pointsMilli: scorePointsMilli + rankBonusMilli,
		};
	});
}
