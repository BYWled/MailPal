import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDestinationsForUser, putDestination } from '$lib/kv.js';
import type { DestinationAddress } from '$lib/types.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const destinations = await listDestinationsForUser(locals.kv, locals.user);
	destinations.sort((a, b) => a.createdAt - b.createdAt);
	return json(destinations);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { email } = (await request.json().catch(() => ({}))) as { email?: string };
	const cleanEmail = email?.toLowerCase().trim();

	if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
		return json({ error: 'A valid email address is required' }, { status: 400 });
	}

	const userDestinations = await listDestinationsForUser(locals.kv, locals.user);
	if (userDestinations.some((d) => d.email.toLowerCase() === cleanEmail)) {
		return json({ error: 'Address already exists' }, { status: 409 });
	}

	const dest: DestinationAddress = {
		email: cleanEmail,
		createdAt: Date.now(),
		createdBy: locals.user.username
	};
	await putDestination(locals.kv, dest);
	return json(dest, { status: 201 });
};
