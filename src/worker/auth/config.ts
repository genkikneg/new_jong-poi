export interface WebAuthnConfig {
	rpId: string;
	origin: string;
}

export function getWebAuthnConfig(env: Env): WebAuthnConfig {
	return {
		rpId: env.WEBAUTHN_RP_ID,
		origin: env.WEBAUTHN_ORIGIN,
	};
}
