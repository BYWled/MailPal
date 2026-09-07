import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		authMode: locals.authMode,
		authenticated: locals.authenticated,
		user: locals.user,
		demo: locals.demo ?? false
	};
};
