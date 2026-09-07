import type { PageServerLoad } from './$types';
import {
	listDomainsForUser,
	listAliases,
	listDestinationsForUser,
	listTags,
	getUser,
	getSystemSettings,
	getUserDomainQuota
} from '$lib/kv.js';
import { maskLocalPart, maskEmailAddress } from '$lib/mask.js';

export const load: PageServerLoad = async ({ locals }) => {
	const [domains, destinations, tags, onboardedFlag, settings] = await Promise.all([
		listDomainsForUser(locals.kv, locals.user),
		listDestinationsForUser(locals.kv, locals.user),
		listTags(locals.kv),
		locals.kv.get('settings:onboarded'),
		getSystemSettings(locals.kv)
	]);

	domains.sort((a, b) => a.createdAt - b.createdAt);
	destinations.sort((a, b) => a.createdAt - b.createdAt);
	tags.sort((a, b) => a.createdAt - b.createdAt);

	const rawAliases = (await Promise.all(domains.map((d) => listAliases(locals.kv, d.domain)))).flat();
	rawAliases.sort((a, b) => b.createdAt - a.createdAt);

	const isSuperadmin = locals.user?.role === 'superadmin';
	const currentUsername = locals.user?.username?.toLowerCase().trim();

	// Privacy protection: for aliases belonging to other users, mask local-part and strip targetEmail
	const allAliases = rawAliases.map((a) => {
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

	let userQuota = settings.defaultUserAliasQuota;
	let userAliasCount = 0;
	const userDomainQuotas: Record<string, number> = {};
	const userDomainCounts: Record<string, number> = {};

	if (locals.user) {
		const userObj = await getUser(locals.kv, locals.user.username);
		if (userObj?.maxAliases != null) {
			userQuota = userObj.maxAliases;
		}
		const currentUsername = locals.user.username;
		const normCurrentUser = currentUsername.toLowerCase().trim();
		userAliasCount = rawAliases.filter(
			(a) => a.createdBy?.toLowerCase().trim() === normCurrentUser
		).length;
		for (const d of domains) {
			const normDomain = d.domain.toLowerCase().trim();
			userDomainQuotas[d.domain] = getUserDomainQuota(userObj, d.domain, settings.defaultUserAliasQuota);
			userDomainCounts[d.domain] = rawAliases.filter(
				(a) => a.domain.toLowerCase().trim() === normDomain && a.createdBy?.toLowerCase().trim() === normCurrentUser
			).length;
		}
	}

	const sanitizedDomains = domains.map((d) => {
		const isOwner = d.ownerUsername?.toLowerCase().trim() === currentUsername;
		if (!isOwner && !isSuperadmin) {
			return {
				...d,
				targetEmail: d.targetEmail ? maskEmailAddress(d.targetEmail) : ''
			};
		}
		return d;
	});

	return {
		domains: sanitizedDomains,
		allAliases,
		destinations,
		tags,
		onboarded: onboardedFlag === '1',
		userQuota,
		userAliasCount,
		userDomainQuotas,
		userDomainCounts,
		user: locals.user,
		demo: locals.demo ?? false
	};
};
