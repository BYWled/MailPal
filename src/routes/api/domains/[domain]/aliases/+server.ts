import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDomain,
	getAlias,
	listAliases,
	putAlias,
	isAliasBlacklisted,
	listBlacklist,
	getUser,
	getSystemSettings,
	getUserDomainQuota
} from '$lib/kv.js';
import { generateSlug } from '$lib/sluggen.js';
import { maskLocalPart } from '$lib/mask.js';
import type { AliasConfig } from '$lib/types.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const domain = await getDomain(locals.kv, params.domain);
	if (!domain) return json({ error: 'Domain not found' }, { status: 404 });

	const aliases = await listAliases(locals.kv, params.domain);
	const isSuperadmin = locals.user?.role === 'superadmin';
	const currentUsername = locals.user?.username?.toLowerCase().trim();

	const sanitized = aliases.map((a) => {
		const isOwner = a.createdBy?.toLowerCase().trim() === currentUsername;
		if (!isOwner && !isSuperadmin) {
			return {
				...a,
				localPart: maskLocalPart(a.localPart),
				targetEmail: null,
				note: undefined,
				tags: [],
				isOtherUser: true
			};
		}
		return {
			...a,
			isOtherUser: false
		};
	});

	sanitized.sort((a, b) => a.createdAt - b.createdAt);
	return json(sanitized);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const domain = await getDomain(locals.kv, params.domain);
	if (!domain) return json({ error: 'Domain not found' }, { status: 404 });
	if (!domain.enabled) {
		return json({ error: 'Domain is disabled' }, { status: 400 });
	}

	// 1. Check domain 50 aliases limit
	const existingAliases = await listAliases(locals.kv, params.domain);
	if (existingAliases.length >= 50) {
		return json({ error: 'This domain has reached the maximum limit of 50 email aliases' }, { status: 400 });
	}

	// 2. Check user quota per domain (if not superadmin)
	if (locals.user && locals.user.role !== 'superadmin') {
		const [userObj, settings] = await Promise.all([
			getUser(locals.kv, locals.user.username),
			getSystemSettings(locals.kv)
		]);
		const domainQuota = getUserDomainQuota(userObj, params.domain, settings.defaultUserAliasQuota);
		if (domainQuota <= 0) {
			return json(
				{ error: `You do not have quota to create aliases on domain ${params.domain}` },
				{ status: 403 }
			);
		}
		const normUser = locals.user.username.toLowerCase().trim();
		const userCountOnDomain = existingAliases.filter(
			(a) => a.createdBy?.toLowerCase().trim() === normUser
		).length;
		if (userCountOnDomain >= domainQuota) {
			return json(
				{ error: `You have reached your allowed quota of ${domainQuota} email aliases on domain ${params.domain}` },
				{ status: 400 }
			);
		}
	}

	const body = await request.json().catch(() => ({}));
	let { localPart, targetEmail = null, note, tags, expiresAt, maxForwards } = body as { localPart?: string; targetEmail?: string | null; note?: string; tags?: string[]; expiresAt?: number; maxForwards?: number };

	if (!localPart) {
		// Auto-generate unique slug not in blacklist and not existing (in-memory fast collision check)
		const existingLocalParts = new Set(existingAliases.map((a) => a.localPart.toLowerCase().trim()));
		const blacklistRules = await listBlacklist(locals.kv, params.domain);

		const isSlugTaken = (slug: string) => {
			const normSlug = slug.toLowerCase().trim();
			if (existingLocalParts.has(normSlug)) return true;
			for (const rule of blacklistRules) {
				const pat = rule.pattern.toLowerCase().trim();
				if (pat === normSlug) return true;
				if (pat.includes('*')) {
					const regex = new RegExp(`^${pat.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
					if (regex.test(normSlug)) return true;
				}
			}
			return false;
		};

		let attempts = 0;
		do {
			localPart = generateSlug();
			attempts++;
		} while (isSlugTaken(localPart) && attempts < 15);
	} else {
		// Validate local part
		if (!/^[a-zA-Z0-9._+-]+$/.test(localPart)) {
			return json({ error: 'Invalid localPart' }, { status: 400 });
		}
		if (localPart.length > 64) {
			return json({ error: 'Local part must be 64 characters or fewer' }, { status: 400 });
		}

		// Check Blacklist
		const isBlocked = await isAliasBlacklisted(locals.kv, params.domain, localPart);
		if (isBlocked) {
			return json(
				{ error: `Alias "${localPart}" is blacklisted (conflicts with existing DNS or reserved name)` },
				{ status: 400 }
			);
		}

		const existing = await getAlias(locals.kv, params.domain, localPart);
		if (existing) return json({ error: 'Alias already exists' }, { status: 409 });
	}

	const config: AliasConfig = {
		localPart,
		domain: params.domain,
		targetEmail: targetEmail ?? null,
		enabled: true,
		createdAt: Date.now(),
		forwardedCount: 0,
		blockedCount: 0,
		lastUsedAt: null,
		autoCreated: false,
		createdBy: locals.user?.username,
		...(note && { note }),
		...(tags && { tags }),
		...(expiresAt != null && { expiresAt }),
		...(maxForwards != null && { maxForwards })
	};

	await putAlias(locals.kv, config);
	return json(config, { status: 201 });
};
