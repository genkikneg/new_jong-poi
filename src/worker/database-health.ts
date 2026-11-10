export interface DatabaseHealthRow {
	value: number;
}

/**
 * Keeps the health endpoint independent from application tables so it remains
 * valid before any feature-specific data exists in D1.
 */
export async function isDatabaseAvailable(db: D1Database): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 AS value")
		.first<DatabaseHealthRow>();

	return row?.value === 1;
}
