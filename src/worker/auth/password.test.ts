import { describe, expect, it } from "vitest";
import { passwordProofForHash } from "./password";

describe("legacy password login proof", () => {
	it("is deterministic for the stored bcrypt hash and one-time challenge", async () => {
		const hash = "$2y$12$abcdefghijklmnopqrstuu7uoF0JfH8D5lcjo6Kml2qQJw1O5Fu";
		const first = await passwordProofForHash(hash, "challenge-a");
		const second = await passwordProofForHash(hash, "challenge-a");
		const other = await passwordProofForHash(hash, "challenge-b");

		expect(first).toBe(second);
		expect(first).not.toBe(other);
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});
