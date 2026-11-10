import {
	verifyRegistrationResponse,
	type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { findActiveWebAuthnChallenge } from "./challenge";
import type { WebAuthnConfig } from "./config";
import { createSession, type AuthenticatedUser } from "./session";

export class RegistrationVerificationError extends Error {
	constructor() {
		super("Passkey registration could not be verified.");
		this.name = "RegistrationVerificationError";
	}
}

export interface CompletedRegistration {
	user: AuthenticatedUser;
	session: Awaited<ReturnType<typeof createSession>>;
}

export async function completePasskeyRegistration(
	db: D1Database,
	config: WebAuthnConfig,
	challengeId: string,
	response: RegistrationResponseJSON,
	nowMs = Date.now(),
): Promise<CompletedRegistration> {
	const challenge = await findActiveWebAuthnChallenge(
		db,
		challengeId,
		"registration",
		nowMs,
	);
	if (!challenge) {
		throw new RegistrationVerificationError();
	}

	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge: challenge.challenge,
		expectedOrigin: config.origin,
		expectedRPID: config.rpId,
		requireUserVerification: true,
	});
	if (!verification.verified) {
		throw new RegistrationVerificationError();
	}

	const credential = verification.registrationInfo.credential;
	const publicKey = new Uint8Array(credential.publicKey).buffer;
	const transports = response.response.transports ?? [];

	await db.batch([
		db
			.prepare(
				`INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms)
				 VALUES (?1, ?2, ?3, ?4, ?4)`,
			)
			.bind(challenge.userId, challenge.userName, challenge.displayName, nowMs),
		db
			.prepare(
				`INSERT INTO webauthn_credentials
					(credential_id, user_id, public_key, sign_count, transports_json, created_at_ms)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
			.bind(
				credential.id,
				challenge.userId,
				publicKey,
				credential.counter,
				JSON.stringify(transports),
				nowMs,
			),
		db
			.prepare(
				"UPDATE webauthn_challenges SET used_at_ms = ?1 WHERE id = ?2 AND used_at_ms IS NULL",
			)
			.bind(nowMs, challenge.id),
	]);

	const session = await createSession(db, challenge.userId, nowMs);
	return {
		user: {
			id: challenge.userId,
			userId: challenge.userName,
			displayName: challenge.displayName,
		},
		session,
	};
}
