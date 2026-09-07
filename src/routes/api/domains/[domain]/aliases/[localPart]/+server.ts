import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAlias, deleteLog, getAlias, putAlias, getDomain } from '$lib/kv.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const alias = await getAlias(locals.kv, params.domain, params.localPart);
	if (!alias) return json({ error: 'Not found' }, { status: 404 });
	return json(alias);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const alias = await getAlias(locals.kv, params.domain, params.localPart);
	if (!alias) return json({ error: 'Not found' }, { status: 404 });

	const domain = await getDomain(locals.kv, params.domain);
	if (
		locals.user?.role !== 'superadmin' &&
		domain?.ownerUsername &&
		domain.ownerUsername !== locals.user?.username &&
		alias.createdBy !== locals.user?.username
	) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json();
	const { enabled, targetEmail, note, tags, expiresAt, maxForwards } = body;

	const updated = { ...alias };
	if (enabled !== undefined) updated.enabled = enabled;
	if (targetEmail !== undefined) updated.targetEmail = targetEmail === '' ? null : targetEmail;
	if (note !== undefined) updated.note = note || undefined;
	if (tags !== undefined) updated.tags = tags;
	if (expiresAt !== undefined) updated.expiresAt = expiresAt ?? undefined;
	if (maxForwards !== undefined) updated.maxForwards = maxForwards ?? undefined;

	await putAlias(locals.kv, updated);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const alias = await getAlias(locals.kv, params.domain, params.localPart);
	if (!alias) return json({ error: 'Not found' }, { status: 404 });

	const domain = await getDomain(locals.kv, params.domain);
	if (
		locals.user?.role !== 'superadmin' &&
		domain?.ownerUsername &&
		domain.ownerUsername !== locals.user?.username &&
		alias.createdBy !== locals.user?.username
	) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	await Promise.all([
		deleteAlias(locals.kv, params.domain, params.localPart),
		deleteLog(locals.kv, params.domain, params.localPart)
	]);
	return new Response(null, { status: 204 });
};
