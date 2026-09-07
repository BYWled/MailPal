import type { KVNamespace } from '@cloudflare/workers-types';
import type {
	AliasConfig,
	DestinationAddress,
	DomainConfig,
	LogEntry,
	Tag,
	User,
	SystemSettings,
	BlacklistEntry
} from './types.js';

export const MAX_ALIASES_PER_DOMAIN = 50;
export const DEFAULT_USER_ALIAS_QUOTA = 20;

// ─── In-Memory Cache (Isolate-level) ──────────────────────────────────────────
// Cloudflare Workers keeps module-level variables alive across requests in the same isolate.
// Caching reads dramatically reduces KV operations (especially the tight 1,000 lists/day limit).

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function isDemoKV(kv: KVNamespace): boolean {
	return (kv as unknown as { isDemo?: boolean }).isDemo === true;
}

function getCached<T>(key: string): T | undefined {
	const entry = memoryCache.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		memoryCache.delete(key);
		return undefined;
	}
	return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs = 60_000): void {
	memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(prefixOrKey?: string): void {
	if (!prefixOrKey) {
		memoryCache.clear();
		return;
	}
	for (const key of memoryCache.keys()) {
		if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
			memoryCache.delete(key);
		}
	}
}

// ─── Initial Setup Flag (Zero-KV checking after setup) ───────────────────────
let memorySetupCompleted = false;

export function isSetupCompletedInMemory(): boolean {
	return memorySetupCompleted;
}

export function setSetupCompletedInMemory(completed: boolean): void {
	memorySetupCompleted = completed;
}

export async function markSetupCompleted(kv: KVNamespace): Promise<void> {
	memorySetupCompleted = true;
	if (!isDemoKV(kv)) {
		try {
			await kv.put('settings:setup_completed', '1');
		} catch {
			// ignore transient error
		}
	}
}

export async function isInitialSetupRequired(kv: KVNamespace): Promise<boolean> {
	if (memorySetupCompleted) return false;
	if (isDemoKV(kv)) {
		const count = await countUsers(kv);
		return count === 0;
	}

	// 1. Check single key get (cheap get instead of expensive list)
	const flag = await kv.get('settings:setup_completed');
	if (flag === '1') {
		memorySetupCompleted = true;
		return false;
	}

	// 2. Fallback check: count users
	const count = await countUsers(kv);
	if (count > 0) {
		memorySetupCompleted = true;
		await markSetupCompleted(kv);
		return false;
	}

	return true;
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

export async function getDomain(
	kv: KVNamespace,
	domain: string
): Promise<DomainConfig | null> {
	const normDomain = domain.toLowerCase().trim();
	if (!isDemoKV(kv)) {
		const cached = getCached<DomainConfig>(`domain:${normDomain}`);
		if (cached !== undefined) return cached;
	}

	const val = await kv.get(`domain:${normDomain}`);
	const parsed = val ? (JSON.parse(val) as DomainConfig) : null;
	if (!isDemoKV(kv) && parsed) {
		setCached(`domain:${normDomain}`, parsed, 60_000);
	}
	return parsed;
}

export async function putDomain(kv: KVNamespace, config: DomainConfig): Promise<void> {
	const normDomain = config.domain.toLowerCase().trim();
	await kv.put(`domain:${normDomain}`, JSON.stringify(config));
	if (!isDemoKV(kv)) {
		invalidateCache('domains:');
		invalidateCache(`domain:${normDomain}`);
	}
}

export async function deleteDomain(kv: KVNamespace, domain: string): Promise<void> {
	const normDomain = domain.toLowerCase().trim();
	await kv.delete(`domain:${normDomain}`);
	if (!isDemoKV(kv)) {
		invalidateCache('domains:');
		invalidateCache(`domain:${normDomain}`);
		invalidateCache(`aliases:list:${normDomain}`);
	}
}

export async function listDomains(kv: KVNamespace): Promise<DomainConfig[]> {
	if (!isDemoKV(kv)) {
		const cached = getCached<DomainConfig[]>('domains:list');
		if (cached) return cached;
	}

	const list = await kv.list({ prefix: 'domain:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DomainConfig) : null;
		})
	);
	const valid = configs.filter((c): c is DomainConfig => c !== null);
	if (!isDemoKV(kv)) {
		setCached('domains:list', valid, 60_000);
	}
	return valid;
}

export async function listDomainsForUser(
	kv: KVNamespace,
	_user?: { username: string; role: 'superadmin' | 'user' }
): Promise<DomainConfig[]> {
	// All users should see the hosted domains so they can view aliases and create aliases
	return await listDomains(kv);
}

export function canManageDomain(
	user: { username: string; role: 'superadmin' | 'user' } | undefined,
	domain: DomainConfig
): boolean {
	if (!user) return false;
	if (user.role === 'superadmin') return true;
	return domain.ownerUsername?.toLowerCase().trim() === user.username.toLowerCase().trim();
}

// ─── Alias helpers ────────────────────────────────────────────────────────────

export function aliasKey(domain: string, localPart: string): string {
	return `alias:${domain.toLowerCase().trim()}/${localPart.toLowerCase().trim()}`;
}

export async function getAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<AliasConfig | null> {
	const normDomain = domain.toLowerCase().trim();
	const normLocal = localPart.toLowerCase().trim();
	const cacheKey = `alias:${normDomain}/${normLocal}`;

	if (!isDemoKV(kv)) {
		const cached = getCached<AliasConfig>(cacheKey);
		if (cached !== undefined) return cached;
	}

	const val = await kv.get(aliasKey(normDomain, normLocal));
	const parsed = val ? (JSON.parse(val) as AliasConfig) : null;
	if (!isDemoKV(kv) && parsed) {
		setCached(cacheKey, parsed, 60_000);
	}
	return parsed;
}

export async function putAlias(kv: KVNamespace, config: AliasConfig): Promise<void> {
	const normDomain = config.domain.toLowerCase().trim();
	const normLocal = config.localPart.toLowerCase().trim();
	await kv.put(aliasKey(normDomain, normLocal), JSON.stringify(config));
	if (!isDemoKV(kv)) {
		invalidateCache(`aliases:list:${normDomain}`);
		invalidateCache(`alias:${normDomain}/${normLocal}`);
	}
}

export async function deleteAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<void> {
	const normDomain = domain.toLowerCase().trim();
	const normLocal = localPart.toLowerCase().trim();
	await kv.delete(aliasKey(normDomain, normLocal));
	if (!isDemoKV(kv)) {
		invalidateCache(`aliases:list:${normDomain}`);
		invalidateCache(`alias:${normDomain}/${normLocal}`);
	}
}

export async function listAliases(kv: KVNamespace, domain: string): Promise<AliasConfig[]> {
	const normDomain = domain.toLowerCase().trim();
	const cacheKey = `aliases:list:${normDomain}`;

	if (!isDemoKV(kv)) {
		const cached = getCached<AliasConfig[]>(cacheKey);
		if (cached) return cached;
	}

	const list = await kv.list({ prefix: `alias:${normDomain}/` });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as AliasConfig) : null;
		})
	);
	const valid = configs.filter((c): c is AliasConfig => c !== null);
	if (!isDemoKV(kv)) {
		setCached(cacheKey, valid, 60_000);
	}
	return valid;
}

// ─── Destination address helpers ──────────────────────────────────────────────

export async function getDestination(kv: KVNamespace, email: string): Promise<DestinationAddress | null> {
	const normEmail = email.toLowerCase().trim();
	const cacheKey = `destination:${normEmail}`;

	if (!isDemoKV(kv)) {
		const cached = getCached<DestinationAddress>(cacheKey);
		if (cached !== undefined) return cached;
	}

	const val = await kv.get(cacheKey);
	const parsed = val ? (JSON.parse(val) as DestinationAddress) : null;
	if (!isDemoKV(kv) && parsed) {
		setCached(cacheKey, parsed, 60_000);
	}
	return parsed;
}

export async function listDestinations(kv: KVNamespace): Promise<DestinationAddress[]> {
	if (!isDemoKV(kv)) {
		const cached = getCached<DestinationAddress[]>('destinations:list');
		if (cached) return cached;
	}

	const list = await kv.list({ prefix: 'destination:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DestinationAddress) : null;
		})
	);
	const valid = configs.filter((c): c is DestinationAddress => c !== null);
	if (!isDemoKV(kv)) {
		setCached('destinations:list', valid, 60_000);
	}
	return valid;
}

export async function listDestinationsForUser(
	kv: KVNamespace,
	user?: { username: string; role: 'superadmin' | 'user' }
): Promise<DestinationAddress[]> {
	const all = await listDestinations(kv);
	if (!user || user.role === 'superadmin') {
		return all;
	}
	const username = user.username.toLowerCase().trim();
	return all.filter((d) => d.createdBy?.toLowerCase().trim() === username);
}

export async function putDestination(kv: KVNamespace, dest: DestinationAddress): Promise<void> {
	const normEmail = dest.email.toLowerCase().trim();
	await kv.put(`destination:${normEmail}`, JSON.stringify(dest));
	if (!isDemoKV(kv)) {
		invalidateCache('destinations:');
		invalidateCache(`destination:${normEmail}`);
	}
}

export async function deleteDestination(kv: KVNamespace, email: string): Promise<void> {
	const normEmail = email.toLowerCase().trim();
	await kv.delete(`destination:${normEmail}`);
	if (!isDemoKV(kv)) {
		invalidateCache('destinations:');
		invalidateCache(`destination:${normEmail}`);
	}
}

// ─── Activity log helpers ─────────────────────────────────────────────────────

export async function getLog(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<LogEntry[]> {
	const val = await kv.get(`log:${domain}/${localPart}`);
	return val ? (JSON.parse(val) as LogEntry[]) : [];
}

export async function deleteLog(kv: KVNamespace, domain: string, localPart: string): Promise<void> {
	await kv.delete(`log:${domain}/${localPart}`);
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

export async function listTags(kv: KVNamespace): Promise<Tag[]> {
	if (!isDemoKV(kv)) {
		const cached = getCached<Tag[]>('tags:list');
		if (cached) return cached;
	}

	const list = await kv.list({ prefix: 'tag:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as Tag) : null;
		})
	);
	const valid = configs.filter((c): c is Tag => c !== null);
	if (!isDemoKV(kv)) {
		setCached('tags:list', valid, 60_000);
	}
	return valid;
}

export async function putTag(kv: KVNamespace, tag: Tag): Promise<void> {
	await kv.put(`tag:${tag.name}`, JSON.stringify(tag));
	if (!isDemoKV(kv)) {
		invalidateCache('tags:');
	}
}

export async function deleteTag(kv: KVNamespace, name: string): Promise<void> {
	await kv.delete(`tag:${name}`);
	if (!isDemoKV(kv)) {
		invalidateCache('tags:');
	}
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function getUser(kv: KVNamespace, username: string): Promise<User | null> {
	const normUser = username.toLowerCase().trim();
	const cacheKey = `user:${normUser}`;

	if (!isDemoKV(kv)) {
		const cached = getCached<User>(cacheKey);
		if (cached !== undefined) return cached;
	}

	const val = await kv.get(cacheKey);
	const parsed = val ? (JSON.parse(val) as User) : null;
	if (!isDemoKV(kv) && parsed) {
		setCached(cacheKey, parsed, 60_000);
	}
	return parsed;
}

export async function putUser(kv: KVNamespace, user: User): Promise<void> {
	const normUser = user.username.toLowerCase().trim();
	await kv.put(`user:${normUser}`, JSON.stringify(user));
	if (!isDemoKV(kv)) {
		invalidateCache('users:');
		invalidateCache(`user:${normUser}`);
		await markSetupCompleted(kv);
	}
}

export async function deleteUser(kv: KVNamespace, username: string): Promise<void> {
	const normUser = username.toLowerCase().trim();
	await kv.delete(`user:${normUser}`);
	if (!isDemoKV(kv)) {
		invalidateCache('users:');
		invalidateCache(`user:${normUser}`);
		const remaining = await listUsers(kv);
		if (remaining.length === 0) {
			setSetupCompletedInMemory(false);
			try {
				await kv.delete('settings:setup_completed');
			} catch {
				// ignore
			}
		}
	}
}

export async function listUsers(kv: KVNamespace): Promise<User[]> {
	if (!isDemoKV(kv)) {
		const cached = getCached<User[]>('users:list');
		if (cached) return cached;
	}

	const list = await kv.list({ prefix: 'user:' });
	const users = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as User) : null;
		})
	);
	const valid = users.filter((u): u is User => u !== null);
	if (!isDemoKV(kv)) {
		setCached('users:list', valid, 60_000);
	}
	return valid;
}

export async function countUsers(kv: KVNamespace): Promise<number> {
	const users = await listUsers(kv);
	return users.length;
}

// ─── System Settings helpers ──────────────────────────────────────────────────

export async function getSystemSettings(kv: KVNamespace): Promise<SystemSettings> {
	if (!isDemoKV(kv)) {
		const cached = getCached<SystemSettings>('settings:system');
		if (cached) return cached;
	}

	const val = await kv.get('settings:system');
	let res: SystemSettings;
	if (!val) {
		res = {
			defaultUserAliasQuota: DEFAULT_USER_ALIAS_QUOTA,
			maxAliasesPerDomain: MAX_ALIASES_PER_DOMAIN,
			autoSyncEnabled: true,
			autoSyncIntervalHours: 6
		};
	} else {
		try {
			const parsed = JSON.parse(val) as Partial<SystemSettings>;
			res = {
				defaultUserAliasQuota: parsed.defaultUserAliasQuota ?? DEFAULT_USER_ALIAS_QUOTA,
				maxAliasesPerDomain: parsed.maxAliasesPerDomain ?? MAX_ALIASES_PER_DOMAIN,
				cfApiToken: parsed.cfApiToken,
				cfAccountId: parsed.cfAccountId,
				autoSyncEnabled: parsed.autoSyncEnabled ?? true,
				autoSyncIntervalHours: parsed.autoSyncIntervalHours ?? 6,
				lastSyncStatus: parsed.lastSyncStatus
			};
		} catch {
			res = {
				defaultUserAliasQuota: DEFAULT_USER_ALIAS_QUOTA,
				maxAliasesPerDomain: MAX_ALIASES_PER_DOMAIN,
				autoSyncEnabled: true,
				autoSyncIntervalHours: 6
			};
		}
	}
	if (!isDemoKV(kv)) {
		setCached('settings:system', res, 120_000);
	}
	return res;
}

export async function putSystemSettings(
	kv: KVNamespace,
	settings: SystemSettings
): Promise<void> {
	await kv.put('settings:system', JSON.stringify(settings));
	if (!isDemoKV(kv)) {
		invalidateCache('settings:system');
	}
}

// ─── Blacklist helpers ────────────────────────────────────────────────────────

export function blacklistKey(domain: string | undefined, pattern: string): string {
	const d = domain ? domain.toLowerCase().trim() : 'global';
	return `blacklist:${d}:${pattern.toLowerCase().trim()}`;
}

export async function getBlacklist(
	kv: KVNamespace,
	id: string
): Promise<BlacklistEntry | null> {
	const cleanId = id.startsWith('blacklist:') ? id.slice('blacklist:'.length) : id;
	if (!isDemoKV(kv)) {
		const cached = getCached<BlacklistEntry>(`blacklist:${cleanId}`);
		if (cached !== undefined) return cached;
	}

	const val = await kv.get(`blacklist:${cleanId}`);
	const parsed = val ? (JSON.parse(val) as BlacklistEntry) : null;
	if (!isDemoKV(kv) && parsed) {
		setCached(`blacklist:${cleanId}`, parsed, 60_000);
	}
	return parsed;
}

export async function putBlacklist(
	kv: KVNamespace,
	entry: BlacklistEntry
): Promise<void> {
	const key = blacklistKey(entry.domain, entry.pattern);
	await kv.put(key, JSON.stringify(entry));
	if (!isDemoKV(kv)) {
		invalidateCache('blacklist:');
	}
}

export async function deleteBlacklist(
	kv: KVNamespace,
	id: string
): Promise<void> {
	// id can be "global:pattern" or "domain.com:pattern" or "blacklist:..."
	const cleanId = id.startsWith('blacklist:') ? id.slice('blacklist:'.length) : id;
	await kv.delete(`blacklist:${cleanId}`);
	if (!isDemoKV(kv)) {
		invalidateCache('blacklist:');
	}
}

export async function listBlacklist(
	kv: KVNamespace,
	domain?: string
): Promise<BlacklistEntry[]> {
	const isDemo = isDemoKV(kv);
	let valid: BlacklistEntry[] | undefined;

	if (!isDemo) {
		valid = getCached<BlacklistEntry[]>('blacklist:list:all');
	}

	if (!valid) {
		const list = await kv.list({ prefix: 'blacklist:' });
		const entries = await Promise.all(
			list.keys.map(async (k) => {
				const val = await kv.get(k.name);
				return val ? (JSON.parse(val) as BlacklistEntry) : null;
			})
		);
		valid = entries.filter((e): e is BlacklistEntry => e !== null);
		if (!isDemo) {
			setCached('blacklist:list:all', valid, 60_000);
		}
	}

	if (!domain) return valid;
	const normDomain = domain.toLowerCase().trim();
	return valid.filter((e) => !e.domain || e.domain.toLowerCase().trim() === normDomain);
}

export async function isAliasBlacklisted(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<boolean> {
	const normLocal = localPart.toLowerCase().trim();
	const normDomain = domain.toLowerCase().trim();

	// Check cached list of rules first (no KV list or get when cached!)
	const allRules = await listBlacklist(kv, normDomain);
	for (const rule of allRules) {
		const pat = rule.pattern.toLowerCase().trim();
		if (pat === normLocal) return true;
		if (pat.includes('*')) {
			const regex = new RegExp(`^${pat.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
			if (regex.test(normLocal)) return true;
		}
	}

	return false;
}

// ─── Alias Limits & Quotas ───────────────────────────────────────────────────

export async function countDomainAliases(kv: KVNamespace, domain: string): Promise<number> {
	const aliases = await listAliases(kv, domain);
	return aliases.length;
}

export async function countUserAliases(kv: KVNamespace, username: string): Promise<number> {
	const normUser = username.toLowerCase().trim();
	const domains = await listDomains(kv);
	let count = 0;
	await Promise.all(
		domains.map(async (d) => {
			const aliases = await listAliases(kv, d.domain);
			count += aliases.filter((a) => a.createdBy?.toLowerCase().trim() === normUser).length;
		})
	);
	return count;
}

export function getUserDomainQuota(
	user: User | null | undefined,
	domain: string,
	defaultQuota = DEFAULT_USER_ALIAS_QUOTA
): number {
	if (!user) return defaultQuota;
	const normDomain = domain.toLowerCase().trim();
	if (user.domainQuotas && user.domainQuotas[normDomain] != null) {
		return user.domainQuotas[normDomain];
	}
	return user.maxAliases ?? defaultQuota;
}

export async function countUserAliasesOnDomain(
	kv: KVNamespace,
	username: string,
	domain: string
): Promise<number> {
	const normUser = username.toLowerCase().trim();
	const aliases = await listAliases(kv, domain);
	return aliases.filter((a) => a.createdBy?.toLowerCase().trim() === normUser).length;
}

