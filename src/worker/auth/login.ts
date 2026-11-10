import {
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type AuthenticationResponseJSON,
	type WebAuthnCredential,
} from "@simplewebauthn/server";
import { createWebAuthnChallenge, findActiveWebAuthnChallenge } from "./challenge";
import type { WebAuthnConfig } from "./config";
import { createSession, type AuthenticatedUser } from "./session";

interface CredentialRow {
	credential_id: string;
	user_id: string;
	user_name: string;
	display_name: string;
	public_key: ArrayBuffer;
	sign_count: number;
	transports_json: string;
}

export class LoginError extends Error {
	constructor() {
		super("Passkey login could not be completed.");
		this.name = "LoginError";
	}
}

function parseTransports(serialized: string): string[] {
	try {
		const value: unknown = JSON.parse(serialized);
		return Array.isArray(value) && value.every((entry) => typeof entry === "string")
			? value
			: [];
	} catch {
		return [];
	}
}

export async function beginPasskeyLogin(
	db: D1Database,
	config: WebAuthnConfig,
): Promise<{ challengeId: string; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }> {
	const options = await generateAuthenticationOptions({
		rpID: config.rpId,
		userVerification: "required",
		allowCredentials: [],
	});
	const challenge = await createWebAuthnChallenge(db, {
		ceremony: "authentication",
		challenge: options.challenge,
		userId: "",
		userName: "",
		displayName: "",
	});

	return { challengeId: challenge.id, options };
}

export async function completePasskeyLogin(
	db: D1Database,
	config: WebAuthnConfig,
	challengeId: string,
	response: AuthenticationResponseJSON,
	nowMs = Date.now(),
): Promise<{ user: AuthenticatedUser; session: Awaited<ReturnType<typeof createSession>> }> {
	const challenge = await findActiveWebAuthnChallenge(
		db,
		challengeId,
		"authentication",
		nowMs,
	);
	if (!challenge) {
		throw new LoginError();
	}

	const credential = await db
		.prepare(
			`SELECT credentials.credential_id, credentials.user_id, credentials.public_key,
			        credentials.sign_count, credentials.transports_json,
			        users.user_id AS user_name, users.display_name
			 FROM webauthn_credentials AS credentials
			 JOIN users ON users.id = credentials.user_id
			 WHERE credentials.credential_id = ?1`,
		)
		.bind(response.id)
		.first<CredentialRow>();
	if (!credential) {
		throw new LoginError();
	}

	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge: challenge.challenge,
		expectedOrigin: config.origin,
		expectedRPID: config.rpId,
		requireUserVerification: true,
		credential: {
			id: credential.credential_id,
			publicKey: new Uint8Array(credential.public_key),
			counter: credential.sign_count,
			transports: parseTransports(credential.transports_json),
		} satisfies WebAuthnCredential,
	});
	if (!verification.verified) {
		throw new LoginError();
	}

	await db.batch([
		db
			.prepare(
				"UPDATE webauthn_credentials SET sign_count = ?1, last_used_at_ms = ?2 WHERE credential_id = ?3",
			)
			.bind(verification.authenticationInfo.newCounter, nowMs, credential.credential_id),
		db
			.prepare(
				"UPDATE webauthn_challenges SET used_at_ms = ?1 WHERE id = ?2 AND used_at_ms IS NULL",
			)
			.bind(nowMs, challenge.id),
	]);

	const session = await createSession(db, credential.user_id, nowMs);
	return {
		user: {
			id: credential.user_id,
			userId: credential.user_name,
			displayName: credential.display_name,
		},
		session,
	};
}
