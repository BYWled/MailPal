import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSystemSettings, listDestinationsForUser, getDestination } from '$lib/kv.js';
import {
	getCloudflareAccountId,
	listCloudflareDestinationAddresses,
	createCloudflareDestinationAddress,
	resolveCloudflareToken
} from '$lib/cloudflare.js';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const settings = await getSystemSettings(locals.kv);
	const token = resolveCloudflareToken(platform, settings);

	if (!token) {
		return json({
			tokenConfigured: false,
			message: 'Cloudflare API token is not configured',
			statuses: {}
		});
	}

	try {
		const accountId = await getCloudflareAccountId(token);
		if (!accountId) {
			return json({
				tokenConfigured: true,
				error: 'Unable to determine Cloudflare Account ID. Please verify your API token permissions (Account: Read or Zone: Read).',
				statuses: {}
			});
		}

		const [destinations, cfAddresses] = await Promise.all([
			listDestinationsForUser(locals.kv, locals.user),
			listCloudflareDestinationAddresses(token, accountId)
		]);

		const cfMap = new Map<string, { id: string; verified: boolean; status: 'verified' | 'pending'; created: string }>();
		for (const addr of cfAddresses) {
			const isVerified = Boolean(addr.verified);
			cfMap.set(addr.email.toLowerCase(), {
				id: addr.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: addr.created
			});
		}

		const statuses: Record<string, { id?: string; verified: boolean; status: 'verified' | 'pending' | 'not_in_cf'; created?: string }> = {};
		for (const d of destinations) {
			const key = d.email.toLowerCase();
			const info = cfMap.get(key);
			if (info) {
				statuses[d.email] = info;
			} else {
				statuses[d.email] = {
					verified: false,
					status: 'not_in_cf'
				};
			}
		}

		return json({
			tokenConfigured: true,
			accountId,
			statuses
		});
	} catch (err: any) {
		return json(
			{
				tokenConfigured: true,
				error: err?.message || 'Failed to probe Cloudflare destination addresses',
				statuses: {}
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		email?: string;
		action?: 'probe' | 'add_to_cf';
	};

	const email = body.email?.toLowerCase().trim();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'A valid email address is required' }, { status: 400 });
	}

	if (locals.user.role !== 'superadmin') {
		const existing = await getDestination(locals.kv, email);
		if (existing && existing.createdBy && existing.createdBy !== locals.user.username) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const settings = await getSystemSettings(locals.kv);
	const token = resolveCloudflareToken(platform, settings);

	if (!token) {
		return json(
			{
				error: 'Cloudflare API token not configured. Please configure it in System Settings or environment secrets.'
			},
			{ status: 400 }
		);
	}

	try {
		const accountId = await getCloudflareAccountId(token);
		if (!accountId) {
			return json(
				{
					error: 'Unable to determine Cloudflare Account ID. Please verify token permissions.'
				},
				{ status: 400 }
			);
		}

		if (body.action === 'add_to_cf') {
			const created = await createCloudflareDestinationAddress(token, accountId, email);
			const isVerified = Boolean(created.verified);
			return json({
				success: true,
				email,
				id: created.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: created.created,
				message: 'Added to Cloudflare. Verification email has been sent.'
			});
		}

		// Default: probe
		const cfAddresses = await listCloudflareDestinationAddresses(token, accountId);
		const match = cfAddresses.find((a) => a.email.toLowerCase() === email);

		if (match) {
			const isVerified = Boolean(match.verified);
			return json({
				success: true,
				email,
				id: match.id,
				verified: isVerified,
				status: isVerified ? 'verified' : 'pending',
				created: match.created
			});
		}

		return json({
			success: true,
			email,
			verified: false,
			status: 'not_in_cf'
		});
	} catch (err: any) {
		return json(
			{
				error: err?.message || 'Failed to interact with Cloudflare API'
			},
			{ status: 500 }
		);
	}
};
