import { sealData, unsealData } from 'iron-session';

export const COOKIE_NAME = 'mailpal_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface SessionData {
	username: string;
	role: 'superadmin' | 'user';
	authenticated: boolean;
	twoFactorPending?: boolean;
}

export function getSessionSecret(envSecret?: string): string {
	if (envSecret && envSecret.length >= 32) return envSecret;
	if (envSecret && envSecret.length > 0) {
		return (envSecret + '-mailpal-session-secret-padding-must-be-32-chars').slice(0, 32);
	}
	return 'mailpal-secure-default-session-encryption-key-32chars';
}

/**
 * Seals session data into an encrypted, authenticated token string.
 * Uses iron-session (AES-256-CBC + HMAC-SHA-256) compatible with Web Crypto.
 */
export async function createSession(data: SessionData, secret?: string): Promise<string> {
	return sealData(data, { password: getSessionSecret(secret), ttl: COOKIE_MAX_AGE });
}

/**
 * Reads and verifies a sealed session token, returning the decrypted SessionData or null.
 */
export async function readSession(
	sealed: string | undefined,
	secret?: string
): Promise<SessionData | null> {
	if (!sealed) return null;
	try {
		const data = await unsealData<SessionData>(sealed, {
			password: getSessionSecret(secret),
			ttl: COOKIE_MAX_AGE
		});
		return data;
	} catch {
		return null;
	}
}

/**
 * Verifies a sealed session token and returns true if the session is fully authenticated.
 */
export async function verifySession(sealed: string | undefined, secret?: string): Promise<boolean> {
	const session = await readSession(sealed, secret);
	return session !== null && session.authenticated === true && !session.twoFactorPending;
}
