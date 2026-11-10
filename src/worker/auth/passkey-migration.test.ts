import { describe, expect, it } from "vitest";
import { getPasskeyMigrationStatus } from "./passkey-migration";

describe("password to passkey migration", () => {
	it("requires migration only while the legacy password hash exists", async () => {
		const database = {
			prepare: () => ({
				bind: (userId: string) => ({ first: async () => ({ required: userId === "legacy-user" ? 1 : 0 }) }),
			}),
		} as unknown as D1Database;

		await expect(getPasskeyMigrationStatus(database, "legacy-user")).resolves.toEqual({ required: true });
		await expect(getPasskeyMigrationStatus(database, "passkey-user")).resolves.toEqual({ required: false });
	});
});
