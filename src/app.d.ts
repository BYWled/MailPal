import type { KVNamespace } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Platform {
			env: {
				KV: KVNamespace;
				AUTH_PASSWORD?: string;
				DEMO_MODE?: string;
				SESSION_SECRET?: string;
				CF_API_TOKEN?: string;
				CLOUDFLARE_API_TOKEN?: string;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
		interface Locals {
			kv: KVNamespace;
			authMode: 'password' | 'cloudflare-access';
			authenticated: boolean;
			user?: {
				username: string;
				role: 'superadmin' | 'user';
			};
			twoFactorPending?: boolean;
			isInitialSetup?: boolean;
			demo?: boolean;
		}
		interface Error {}
		interface PageData {}
	}
}

export {};
