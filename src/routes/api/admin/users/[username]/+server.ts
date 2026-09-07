import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUser, putUser, deleteUser } from '$lib/kv.js';
import { hashPassword, generateTotpSecret } from '$lib/crypto.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const username = params.username.toLowerCase().trim();
	const user = await getUser(locals.kv, username);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const { maxAliases, domainQuotas, password, reset2Fa } = body;

	if (maxAliases !== undefined) {
		if (maxAliases === null || maxAliases === '') {
			delete user.maxAliases;
		} else {
			const n = Number(maxAliases);
			if (isNaN(n) || n < 0) {
				return json({ error: 'Invalid alias quota value' }, { status: 400 });
			}
			user.maxAliases = n;
		}
	}

	if (domainQuotas !== undefined) {
		if (typeof domainQuotas === 'object' && domainQuotas !== null) {
			const sanitized: Record<string, number> = {};
			for (const [dom, q] of Object.entries(domainQuotas)) {
				if (q === null || q === '') continue;
				const num = Number(q);
				if (!isNaN(num) && num >= 0) {
					sanitized[dom.toLowerCase().trim()] = num;
				}
			}
			user.domainQuotas = sanitized;
		} else {
			delete user.domainQuotas;
		}
	}

	if (password) {
		if (typeof password !== 'string' || password.length < 8) {
			return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
		}
		user.passwordHash = await hashPassword(password);
	}

	if (reset2Fa) {
		user.twoFactorEnabled = false;
		user.twoFactorSecret = generateTotpSecret();
	}

	await putUser(locals.kv, user);

	return json({
		username: user.username,
		role: user.role,
		maxAliases: user.maxAliases,
		domainQuotas: user.domainQuotas ?? {},
		twoFactorEnabled: user.twoFactorEnabled
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const username = params.username.toLowerCase().trim();
	if (username === locals.user.username) {
		return json({ error: 'Cannot delete your own superadmin account' }, { status: 400 });
	}

	const user = await getUser(locals.kv, username);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	await deleteUser(locals.kv, username);
	return new Response(null, { status: 204 });
};
