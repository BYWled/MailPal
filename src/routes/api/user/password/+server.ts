import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUser, putUser } from '$lib/kv.js';
import { verifyPassword, hashPassword } from '$lib/crypto.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		currentPassword?: string;
		newPassword?: string;
	};

	const currentPassword = body.currentPassword || '';
	const newPassword = body.newPassword || '';

	if (!currentPassword || !newPassword) {
		return json({ error: 'Both current and new passwords are required' }, { status: 400 });
	}

	if (newPassword.length < 8) {
		return json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
	}

	const user = await getUser(locals.kv, locals.user.username);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	const isValid = await verifyPassword(currentPassword, user.passwordHash);
	if (!isValid) {
		return json({ error: 'Current password is incorrect' }, { status: 400 });
	}

	user.passwordHash = await hashPassword(newPassword);
	user.updatedAt = Date.now();
	await putUser(locals.kv, user);

	return json({ success: true, message: 'Password updated successfully' });
};
