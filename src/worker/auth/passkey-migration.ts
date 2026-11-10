import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createWebAuthnChallenge, findActiveWebAuthnChallenge } from "./challenge";
import type { WebAuthnConfig } from "./config";

interface MigrationUserRow {
	id: string;
	user_id: string;
	display_name: string;
	legacy_password_hash: string | null;
}

export class PasskeyMigrationError extends Error {
	constructor(readonly code: "INVALID_USER_ID" | "USER_ID_TAKEN" | "MIGRATION_NOT_AVAILABLE" | "INVALID_MIGRATION_RESPONSE" = "INVALID_MIGRATION_RESPONSE") {
		super(code);
		this.name = "PasskeyMigrationError";
	}
}

const PUBLIC_USER_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

async function findMigrationUser(db: D1Database, userId: string): Promise<MigrationUserRow> {
	const user = await db.prepare(
		"SELECT id, user_id, display_name, legacy_password_hash FROM users WHERE id = ?1",
	).bind(userId).first<MigrationUserRow>();
	if (!user?.legacy_password_hash) throw new PasskeyMigrationError("MIGRATION_NOT_AVAILABLE");
	return user;
}

export async function getPasskeyMigrationStatus(db: D1Database, userId: string): Promise<{ required: boolean }> {
	const row = await db.prepare(
		"SELECT legacy_password_hash IS NOT NULL AS required FROM users WHERE id = ?1",
	).bind(userId).first<{ required: number }>();
	return { required: row?.required === 1 };
}

export async function beginPasskeyMigration(db: D1Database, config: WebAuthnConfig, userId: string, publicUserId: string) {
	const user = await findMigrationUser(db, userId);
	const normalizedUserId = publicUserId.trim().toLowerCase();
	if (!PUBLIC_USER_ID_PATTERN.test(normalizedUserId)) throw new PasskeyMigrationError("INVALID_USER_ID");
	const duplicate = await db.prepare(
		"SELECT id FROM users WHERE user_id = ?1 COLLATE NOCASE AND id <> ?2",
	).bind(normalizedUserId, userId).first<{ id: string }>();
	if (duplicate) throw new PasskeyMigrationError("USER_ID_TAKEN");
	const credentials = await db.prepare(
		"SELECT credential_id FROM webauthn_credentials WHERE user_id = ?1",
	).bind(userId).all<{ credential_id: string }>();
	const options = await generateRegistrationOptions({
		rpName: "ジャンポイ",
		rpID: config.rpId,
		userID: new Uint8Array(new TextEncoder().encode(user.id)),
		userName: normalizedUserId,
		userDisplayName: user.display_name,
		attestationType: "none",
		excludeCredentials: credentials.results.map((credential) => ({ id: credential.credential_id })),
		authenticatorSelection: { residentKey: "required", userVerification: "required" },
	});
	const challenge = await createWebAuthnChallenge(db, {
		ceremony: "registration",
		challenge: options.challenge,
		userId: user.id,
		userName: normalizedUserId,
		displayName: user.display_name,
	});
	return { challengeId: challenge.id, options };
}

export async function completePasskeyMigration(
	db: D1Database,
	config: WebAuthnConfig,
	authenticatedUserId: string,
	challengeId: string,
	response: RegistrationResponseJSON,
	nowMs = Date.now(),
): Promise<void> {
	await findMigrationUser(db, authenticatedUserId);
	const challenge = await findActiveWebAuthnChallenge(db, challengeId, "registration", nowMs);
	if (!challenge || challenge.userId !== authenticatedUserId) throw new PasskeyMigrationError("INVALID_MIGRATION_RESPONSE");
	if (!PUBLIC_USER_ID_PATTERN.test(challenge.userName)) throw new PasskeyMigrationError("INVALID_USER_ID");
	const duplicate = await db.prepare(
		"SELECT id FROM users WHERE user_id = ?1 COLLATE NOCASE AND id <> ?2",
	).bind(challenge.userName, authenticatedUserId).first<{ id: string }>();
	if (duplicate) throw new PasskeyMigrationError("USER_ID_TAKEN");
	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge: challenge.challenge,
		expectedOrigin: config.origin,
		expectedRPID: config.rpId,
		requireUserVerification: true,
	});
	if (!verification.verified) throw new PasskeyMigrationError("INVALID_MIGRATION_RESPONSE");

	const credential = verification.registrationInfo.credential;
	await db.batch([
		db.prepare(
			`INSERT INTO webauthn_credentials
			 (credential_id, user_id, public_key, sign_count, transports_json, created_at_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		).bind(
			credential.id,
			authenticatedUserId,
			new Uint8Array(credential.publicKey).buffer,
			credential.counter,
			JSON.stringify(response.response.transports ?? []),
			nowMs,
		),
		db.prepare(
			`UPDATE users
			 SET user_id = ?2, legacy_login_id = NULL, legacy_password_hash = NULL, updated_at_ms = ?3
			 WHERE id = ?1 AND legacy_password_hash IS NOT NULL`,
		).bind(authenticatedUserId, challenge.userName, nowMs),
		db.prepare(
			"UPDATE webauthn_challenges SET used_at_ms = ?1 WHERE id = ?2 AND used_at_ms IS NULL",
		).bind(nowMs, challenge.id),
	]);
}
