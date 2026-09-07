import type { PageServerLoad } from './$types';
import {
	listDomainsForUser,
	listAliases,
	listDestinations,
	listTags,
	getUser,
	getSystemSettings,
	countUserAliases
} from '$lib/kv.js';

export const load: PageServerLoad = async ({ locals }) => {
	const [domains, destinations, tags, onboardedFlag, settings] = await Promise.all([
		listDomainsForUser(locals.kv, locals.user),
		listDestinations(locals.kv),
		listTags(locals.kv),
		locals.kv.get('settings:onboarded'),
		getSystemSettings(locals.kv)
	]);

	domains.sort((a, b) => a.createdAt - b.createdAt);
	destinations.sort((a, b) => a.createdAt - b.createdAt);
	tags.sort((a, b) => a.createdAt - b.createdAt);

	const allAliases = (await Promise.all(domains.map((d) => listAliases(locals.kv, d.domain)))).flat();
	allAliases.sort((a, b) => b.createdAt - a.createdAt);

	let userQuota = settings.defaultUserAliasQuota;
	let userAliasCount = 0;

	if (locals.user) {
		const userObj = await getUser(locals.kv, locals.user.username);
		if (userObj?.maxAliases != null) {
			userQuota = userObj.maxAliases;
		}
		userAliasCount = await countUserAliases(locals.kv, locals.user.username);
	}

	return {
		domains,
		allAliases,
		destinations,
		tags,
		onboarded: onboardedFlag === '1',
		userQuota,
		userAliasCount,
		user: locals.user,
		demo: locals.demo ?? false
	};
};
