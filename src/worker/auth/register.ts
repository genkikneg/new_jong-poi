import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createWebAuthnChallenge } from "./challenge";
import type { WebAuthnConfig } from "./config";

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

export interface RegistrationInput {
	userId: string;
	displayName: string;
}

export class RegistrationInputError extends Error {
	constructor(readonly code: "INVALID_USER_ID" | "INVALID_DISPLAY_NAME" | "USER_ID_TAKEN") {
		super(code);
		this.name = "RegistrationInputError";
	}
}

function normalizeInput(input: RegistrationInput): RegistrationInput {
	const userId = input.userId.trim();
	const displayName = input.displayName.trim();

	if (!USER_ID_PATTERN.test(userId)) throw new RegistrationInputError("INVALID_USER_ID");
	if (displayName.length < 1 || displayName.length > 80) throw new RegistrationInputError("INVALID_DISPLAY_NAME");

	return { userId, displayName };
}

export async function beginPasskeyRegistration(
	db: D1Database,
	config: WebAuthnConfig,
	input: RegistrationInput,
): Promise<{ challengeId: string; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }> {
	const normalizedInput = normalizeInput(input);
	const existingUser = await db
		.prepare("SELECT id FROM users WHERE user_id = ?1")
		.bind(normalizedInput.userId)
		.first<{ id: string }>();

	if (existingUser) {
		throw new RegistrationInputError("USER_ID_TAKEN");
	}

	const userId = crypto.randomUUID();
	const options = await generateRegistrationOptions({
		rpName: "ジャンポイ",
		rpID: config.rpId,
		// Copy into an ArrayBuffer-backed typed array for the WebAuthn server API.
		userID: new Uint8Array(new TextEncoder().encode(userId)),
		userName: normalizedInput.userId,
		userDisplayName: normalizedInput.displayName,
		attestationType: "none",
		authenticatorSelection: {
			residentKey: "required",
			userVerification: "required",
		},
	});
	const challenge = await createWebAuthnChallenge(db, {
		ceremony: "registration",
		challenge: options.challenge,
		userId,
		userName: normalizedInput.userId,
		displayName: normalizedInput.displayName,
	});

	return { challengeId: challenge.id, options };
}
