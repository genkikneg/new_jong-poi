import { describe, expect, it } from "vitest";
import {
	beginPasskeyRegistration,
	RegistrationInputError,
} from "./register";

const config = {
	rpId: "jong-poi.misoon.net",
	origin: "https://jong-poi.misoon.net",
};

describe("beginPasskeyRegistration", () => {
	it("returns WebAuthn options and persists a short-lived challenge", async () => {
		const insertValues: unknown[][] = [];
		const database = {
			prepare: (sql: string) => {
				if (sql.includes("SELECT id FROM users")) {
					return {
						bind: () => ({ first: async () => null }),
					};
				}

				return {
					bind: (...values: unknown[]) => {
						insertValues.push(values);
						return { run: async () => ({ success: true }) };
					},
				};
			},
		} as unknown as D1Database;

		const result = await beginPasskeyRegistration(database, config, {
			userId: "genki_01",
			displayName: "元希",
		});

		expect(result.options.rp.id).toBe(config.rpId);
		expect(result.options.user.name).toBe("genki_01");
		expect(result.options.user.displayName).toBe("元希");
		expect(result.challengeId).toEqual(expect.any(String));
		expect(insertValues).toHaveLength(1);
		expect(insertValues[0]?.[1]).toBe("registration");
		expect(insertValues[0]?.[2]).toBe(result.options.challenge);
	});

	it("rejects unsafe user IDs before querying D1", async () => {
		const database = {
			prepare: () => {
				throw new Error("D1 should not be queried");
			},
		} as unknown as D1Database;

		await expect(
			beginPasskeyRegistration(database, config, {
				userId: "not allowed",
				displayName: "元希",
			}),
		).rejects.toBeInstanceOf(RegistrationInputError);
	});

	it("distinguishes an already-used user ID from an invalid format", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({ first: async () => ({ id: "existing-user" }) }),
			}),
		} as unknown as D1Database;

		await expect(beginPasskeyRegistration(database, config, {
			userId: "genki_01",
			displayName: "元希",
		})).rejects.toMatchObject({ code: "USER_ID_TAKEN" });
	});
});
