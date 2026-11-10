import { describe, expect, it } from "vitest";
import {
	calculateGameResults,
	calculateRanks,
	ScoringValidationError,
	validateSubmittedScores,
	type ScoringRules,
} from "./scoring";

const fourPlayerRules: ScoringRules = {
	playerCount: 4,
	baseScore: 25_000,
	scoreMultiplierBasisPoints: 1_000,
	rankBonusesMilli: {
		1: 20_000,
		2: 10_000,
		3: 0,
		4: -30_000,
	},
};

const members = ["a", "b", "c", "d"];

describe("calculateRanks", () => {
	it("assigns competition ranks when scores tie", () => {
		const ranks = calculateRanks([
			{ userId: "a", finalScore: 30_000 },
			{ userId: "b", finalScore: 30_000 },
			{ userId: "c", finalScore: 20_000 },
			{ userId: "d", finalScore: 20_000 },
		]);

		expect([...ranks.entries()]).toEqual([
			["a", 1],
			["b", 1],
			["c", 3],
			["d", 3],
		]);
	});
});

describe("validateSubmittedScores", () => {
	it("reports the relevant validation failures", () => {
		expect(
			validateSubmittedScores(fourPlayerRules, members, [
				{ userId: "a", finalScore: 25_000 },
				{ userId: "a", finalScore: 25_000 },
				{ userId: "missing", finalScore: 25_000 },
			]),
		).toEqual(
			expect.arrayContaining([
				"PLAYER_COUNT_MISMATCH",
				"DUPLICATE_PLAYER",
				"PLAYER_SET_MISMATCH",
				"SCORE_TOTAL_MISMATCH",
			]),
		);
	});
});

describe("calculateGameResults", () => {
	it("calculates score and placement points using integers", () => {
		const results = calculateGameResults(fourPlayerRules, members, [
			{ userId: "a", finalScore: 30_000 },
			{ userId: "b", finalScore: 26_000 },
			{ userId: "c", finalScore: 24_000 },
			{ userId: "d", finalScore: 20_000 },
		]);

		expect(results).toEqual([
			{
				userId: "a",
				finalScore: 30_000,
				rank: 1,
				scoreDifference: 5_000,
				scorePointsMilli: 500_000,
				rankBonusMilli: 20_000,
				pointsMilli: 520_000,
			},
			{
				userId: "b",
				finalScore: 26_000,
				rank: 2,
				scoreDifference: 1_000,
				scorePointsMilli: 100_000,
				rankBonusMilli: 10_000,
				pointsMilli: 110_000,
			},
			{
				userId: "c",
				finalScore: 24_000,
				rank: 3,
				scoreDifference: -1_000,
				scorePointsMilli: -100_000,
				rankBonusMilli: 0,
				pointsMilli: -100_000,
			},
			{
				userId: "d",
				finalScore: 20_000,
				rank: 4,
				scoreDifference: -5_000,
				scorePointsMilli: -500_000,
				rankBonusMilli: -30_000,
				pointsMilli: -530_000,
			},
		]);
	});

	it("rejects invalid submissions before calculating results", () => {
		expect(() =>
			calculateGameResults(fourPlayerRules, members, [
				{ userId: "a", finalScore: 30_000 },
				{ userId: "b", finalScore: 26_000 },
				{ userId: "c", finalScore: 24_000 },
				{ userId: "d", finalScore: 19_999.5 },
			]),
		).toThrow(ScoringValidationError);
	});
});
