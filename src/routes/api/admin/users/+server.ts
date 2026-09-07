import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listUsers, getUser, putUser, countUserAliases, getSystemSettings } from '$lib/kv.js';
import { hashPassword, generateTotpSecret } from '$lib/crypto.js';
import type { User } from '$lib/types.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const [users, settings] = await Promise.all([
		listUsers(locals.kv),
		getSystemSettings(locals.kv)
	]);

	// Enrich with alias usage
	const enriched = await Promise.all(
		users.map(async (u) => {
			const aliasCount = await countUserAliases(locals.kv, u.username);
			return {
				username: u.username,
				role: u.role,
				createdAt: u.createdAt,
				maxAliases: u.maxAliases ?? settings.defaultUserAliasQuota,
				customQuota: u.maxAliases != null,
				aliasCount,
				twoFactorEnabled: u.twoFactorEnabled
			};
		})
	);

	enriched.sort((a, b) => a.createdAt - b.createdAt);
	return json(enriched);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const username = (body.username as string)?.trim().toLowerCase();
	const password = body.password as string;
	const maxAliases = body.maxAliases != null && body.maxAliases !== '' ? Number(body.maxAliases) : undefined;

	if (!username || username.length < 3 || username.length > 32) {
		return json({ error: 'Username must be between 3 and 32 characters' }, { status: 400 });
	}

	if (!/^[a-z0-9_.-]+$/.test(username)) {
		return json({ error: 'Username can only contain letters, numbers, hyphens, underscores and dots' }, { status: 400 });
	}

	if (!password || password.length < 8) {
		return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
	}

	const existing = await getUser(locals.kv, username);
	if (existing) {
		return json({ error: 'User already exists' }, { status: 409 });
	}

	const passwordHash = await hashPassword(password);
	const twoFactorSecret = generateTotpSecret();

	const newUser: User = {
		username,
		passwordHash,
		role: 'user',
		createdAt: Date.now(),
		maxAliases: maxAliases != null && !isNaN(maxAliases) ? maxAliases : undefined,
		twoFactorSecret,
		twoFactorEnabled: false // Will be forced to bind 2FA upon first login
	};

	await putUser(locals.kv, newUser);

	return json(
		{
			username: newUser.username,
			role: newUser.role,
			createdAt: newUser.createdAt,
			maxAliases: newUser.maxAliases,
			twoFactorEnabled: false
		},
		{ status: 201 }
	);
};
