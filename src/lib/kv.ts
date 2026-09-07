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

// ─── Domain helpers ───────────────────────────────────────────────────────────

export async function getDomain(
	kv: KVNamespace,
	domain: string
): Promise<DomainConfig | null> {
	const val = await kv.get(`domain:${domain}`);
	return val ? (JSON.parse(val) as DomainConfig) : null;
}

export async function putDomain(kv: KVNamespace, config: DomainConfig): Promise<void> {
	await kv.put(`domain:${config.domain}`, JSON.stringify(config));
}

export async function deleteDomain(kv: KVNamespace, domain: string): Promise<void> {
	await kv.delete(`domain:${domain}`);
}

export async function listDomains(kv: KVNamespace): Promise<DomainConfig[]> {
	const list = await kv.list({ prefix: 'domain:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DomainConfig) : null;
		})
	);
	return configs.filter((c): c is DomainConfig => c !== null);
}

export async function listDomainsForUser(
	kv: KVNamespace,
	user?: { username: string; role: 'superadmin' | 'user' }
): Promise<DomainConfig[]> {
	const all = await listDomains(kv);
	if (!user || user.role === 'superadmin') {
		return all;
	}
	return all.filter((d) => d.ownerUsername === user.username);
}

// ─── Alias helpers ────────────────────────────────────────────────────────────

export function aliasKey(domain: string, localPart: string): string {
	return `alias:${domain}/${localPart}`;
}

export async function getAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<AliasConfig | null> {
	const val = await kv.get(aliasKey(domain, localPart));
	return val ? (JSON.parse(val) as AliasConfig) : null;
}

export async function putAlias(kv: KVNamespace, config: AliasConfig): Promise<void> {
	await kv.put(aliasKey(config.domain, config.localPart), JSON.stringify(config));
}

export async function deleteAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<void> {
	await kv.delete(aliasKey(domain, localPart));
}

export async function listAliases(kv: KVNamespace, domain: string): Promise<AliasConfig[]> {
	const list = await kv.list({ prefix: `alias:${domain}/` });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as AliasConfig) : null;
		})
	);
	return configs.filter((c): c is AliasConfig => c !== null);
}

// ─── Destination address helpers ──────────────────────────────────────────────

export async function listDestinations(kv: KVNamespace): Promise<DestinationAddress[]> {
	const list = await kv.list({ prefix: 'destination:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DestinationAddress) : null;
		})
	);
	return configs.filter((c): c is DestinationAddress => c !== null);
}

export async function putDestination(kv: KVNamespace, dest: DestinationAddress): Promise<void> {
	await kv.put(`destination:${dest.email}`, JSON.stringify(dest));
}

export async function deleteDestination(kv: KVNamespace, email: string): Promise<void> {
	await kv.delete(`destination:${email}`);
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
	const list = await kv.list({ prefix: 'tag:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as Tag) : null;
		})
	);
	return configs.filter((c): c is Tag => c !== null);
}

export async function putTag(kv: KVNamespace, tag: Tag): Promise<void> {
	await kv.put(`tag:${tag.name}`, JSON.stringify(tag));
}

export async function deleteTag(kv: KVNamespace, name: string): Promise<void> {
	await kv.delete(`tag:${name}`);
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function getUser(kv: KVNamespace, username: string): Promise<User | null> {
	const val = await kv.get(`user:${username.toLowerCase().trim()}`);
	return val ? (JSON.parse(val) as User) : null;
}

export async function putUser(kv: KVNamespace, user: User): Promise<void> {
	await kv.put(`user:${user.username.toLowerCase().trim()}`, JSON.stringify(user));
}

export async function deleteUser(kv: KVNamespace, username: string): Promise<void> {
	await kv.delete(`user:${username.toLowerCase().trim()}`);
}

export async function listUsers(kv: KVNamespace): Promise<User[]> {
	const list = await kv.list({ prefix: 'user:' });
	const users = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as User) : null;
		})
	);
	return users.filter((u): u is User => u !== null);
}

export async function countUsers(kv: KVNamespace): Promise<number> {
	const list = await kv.list({ prefix: 'user:' });
	return list.keys.length;
}

// ─── System Settings helpers ──────────────────────────────────────────────────

export async function getSystemSettings(kv: KVNamespace): Promise<SystemSettings> {
	const val = await kv.get('settings:system');
	if (!val) {
		return {
			defaultUserAliasQuota: DEFAULT_USER_ALIAS_QUOTA,
			maxAliasesPerDomain: MAX_ALIASES_PER_DOMAIN,
			autoSyncEnabled: true,
			autoSyncIntervalHours: 6
		};
	}
	try {
		const parsed = JSON.parse(val) as Partial<SystemSettings>;
		return {
			defaultUserAliasQuota: parsed.defaultUserAliasQuota ?? DEFAULT_USER_ALIAS_QUOTA,
			maxAliasesPerDomain: parsed.maxAliasesPerDomain ?? MAX_ALIASES_PER_DOMAIN,
			cfApiToken: parsed.cfApiToken,
			autoSyncEnabled: parsed.autoSyncEnabled ?? true,
			autoSyncIntervalHours: parsed.autoSyncIntervalHours ?? 6,
			lastSyncStatus: parsed.lastSyncStatus
		};
	} catch {
		return {
			defaultUserAliasQuota: DEFAULT_USER_ALIAS_QUOTA,
			maxAliasesPerDomain: MAX_ALIASES_PER_DOMAIN,
			autoSyncEnabled: true,
			autoSyncIntervalHours: 6
		};
	}
}

export async function putSystemSettings(
	kv: KVNamespace,
	settings: SystemSettings
): Promise<void> {
	await kv.put('settings:system', JSON.stringify(settings));
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
	const val = await kv.get(`blacklist:${id}`);
	return val ? (JSON.parse(val) as BlacklistEntry) : null;
}

export async function putBlacklist(
	kv: KVNamespace,
	entry: BlacklistEntry
): Promise<void> {
	const key = blacklistKey(entry.domain, entry.pattern);
	await kv.put(key, JSON.stringify(entry));
}

export async function deleteBlacklist(
	kv: KVNamespace,
	id: string
): Promise<void> {
	// id can be "global:pattern" or "domain.com:pattern" or "blacklist:..."
	const cleanId = id.startsWith('blacklist:') ? id.slice('blacklist:'.length) : id;
	await kv.delete(`blacklist:${cleanId}`);
}

export async function listBlacklist(
	kv: KVNamespace,
	domain?: string
): Promise<BlacklistEntry[]> {
	const list = await kv.list({ prefix: 'blacklist:' });
	const entries = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as BlacklistEntry) : null;
		})
	);
	const valid = entries.filter((e): e is BlacklistEntry => e !== null);
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

	// Check direct keys first for high speed
	const globalDirect = await kv.get(`blacklist:global:${normLocal}`);
	if (globalDirect) return true;

	const domainDirect = await kv.get(`blacklist:${normDomain}:${normLocal}`);
	if (domainDirect) return true;

	// Check all blacklist patterns for wildcard support (e.g. "api-*")
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

