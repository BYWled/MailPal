/**
 * Masks an email local-part for privacy protection.
 * Examples:
 * - "test" -> "t**t"
 * - "admin" -> "a***n"
 * - "abc" -> "a*c"
 * - "ab" -> "a*"
 * - "a" -> "*"
 */
export function maskLocalPart(localPart: string): string {
	if (!localPart) return '';
	const clean = localPart.trim();
	const len = clean.length;
	if (len <= 1) return '*';
	if (len === 2) return clean[0] + '*';
	return clean[0] + '*'.repeat(len - 2) + clean[len - 1];
}

/**
 * Masks an entire email address (e.g. "test@wled.top" -> "t**t@wled.top").
 */
export function maskEmailAddress(email: string): string {
	if (!email) return '';
	const atIdx = email.indexOf('@');
	if (atIdx === -1) return maskLocalPart(email);
	const localPart = email.slice(0, atIdx);
	const domain = email.slice(atIdx + 1);
	return `${maskLocalPart(localPart)}@${domain}`;
}
