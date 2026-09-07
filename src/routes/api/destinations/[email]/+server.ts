import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDestination, getDestination } from '$lib/kv.js';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const email = params.email.toLowerCase().trim();
	const existing = await getDestination(locals.kv, email);
	if (existing) {
		const isSuperadmin = locals.user.role === 'superadmin';
		const isCreator = existing.createdBy?.toLowerCase().trim() === locals.user.username.toLowerCase().trim();
		if (!isSuperadmin && !isCreator) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
		await deleteDestination(locals.kv, email);
	}

	return json({ ok: true });
};
