import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteBlacklist } from '$lib/kv.js';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (locals.user?.role !== 'superadmin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const id = params.id;
	if (!id) {
		return json({ error: 'ID required' }, { status: 400 });
	}

	await deleteBlacklist(locals.kv, id);
	return new Response(null, { status: 204 });
};
