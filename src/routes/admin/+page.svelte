<script lang="ts">
	import type { PageData } from './$types';
	import { t } from '$lib/i18n/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';

	let { data }: { data: PageData } = $props();

	type TabType = 'users' | 'domains' | 'blacklist' | 'settings';
	let activeTab = $state<TabType>('users');

	// Local reactive state
	let users = $state(data.users);
	let domains = $state(data.domains);
	let blacklist = $state(data.blacklist);
	let settings = $state(data.settings);

	// User creation modal state
	let showCreateUserModal = $state(false);
	let newUsername = $state('');
	let newPassword = $state('');
	let newMaxAliases = $state('');
	let createUserError = $state('');
	let creatingUser = $state(false);

	// Edit user quota modal state
	let editingUser = $state<any | null>(null);
	let editQuotaValue = $state<number | string>('');
	let editDomainQuotas = $state<Record<string, number | string>>({});
	let savingQuota = $state(false);

	// Reset password modal state
	let resettingUser = $state<any | null>(null);
	let resetNewPassword = $state('');
	let resettingPassword = $state(false);
	let resetPasswordMsg = $state('');

	// DNS Import state
	let zoneInputText = $state('');
	let parsingDns = $state(false);
	let dnsPreview = $state<{ domain: string | null; names: string[]; totalRecords: number } | null>(null);
	let dnsImportDomain = $state<string>('');
	let importingDns = $state(false);
	let dnsSuccessMsg = $state('');
	let dnsErrorMsg = $state('');

	// Cloudflare API Auto-fetch state
	let cfFetchDomain = $state(data.domains.length > 0 ? data.domains[0].domain : '');
	let cfApiTokenInput = $state('');
	let fetchingCfDns = $state(false);
	let cfDnsResult = $state<{ zoneId: string; zoneName: string; totalRecords: number; extractedNames: string[] } | null>(null);
	let importingCfDns = $state(false);
	let cfDnsSuccessMsg = $state('');
	let cfDnsErrorMsg = $state('');

	// Manual blacklist state
	let manualPattern = $state('');
	let manualDomain = $state('');
	let manualDesc = $state('');
	let addingManual = $state(false);
	let manualError = $state('');

	// Settings state
	let defaultQuotaInput = $state(data.settings.defaultUserAliasQuota);
	let cfTokenSettingInput = $state(data.settings.cfApiToken ?? '');
	let autoSyncEnabledInput = $state(data.settings.autoSyncEnabled ?? true);
	let autoSyncIntervalInput = $state(data.settings.autoSyncIntervalHours ?? 6);
	let savingSettings = $state(false);
	let settingsSavedMsg = $state('');

	// Full Cloudflare sync state
	let syncingAll = $state(false);
	let syncAllMsg = $state('');
	let syncAllError = $state('');

	// ── Users Actions ────────────────────────────────────────────────────────
	async function handleCreateUser(e: Event) {
		e.preventDefault();
		createUserError = '';
		creatingUser = true;

		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: newUsername.trim(),
					password: newPassword,
					maxAliases: newMaxAliases ? Number(newMaxAliases) : null
				})
			});
			const body = await res.json();
			if (!res.ok) {
				createUserError = body.error ?? 'Failed to create user';
			} else {
				users = [
					...users,
					{
						username: body.username,
						role: body.role,
						createdAt: body.createdAt,
						maxAliases: body.maxAliases ?? settings.defaultUserAliasQuota,
						customQuota: body.maxAliases != null,
						aliasCount: 0,
						domainQuotas: body.domainQuotas ?? {},
						domainUsage: {},
						twoFactorEnabled: false
					}
				];
				showCreateUserModal = false;
				newUsername = '';
				newPassword = '';
				newMaxAliases = '';
			}
		} catch {
			createUserError = 'Network error';
		} finally {
			creatingUser = false;
		}
	}

	async function handleSaveQuota() {
		if (!editingUser) return;
		savingQuota = true;
		try {
			const val = editQuotaValue === '' ? null : Number(editQuotaValue);
			const cleanDomainQuotas: Record<string, number> = {};
			for (const [dom, q] of Object.entries(editDomainQuotas)) {
				if (q !== '' && q != null && !isNaN(Number(q))) {
					cleanDomainQuotas[dom] = Number(q);
				}
			}
			const res = await fetch(`/api/admin/users/${editingUser.username}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					maxAliases: val,
					domainQuotas: cleanDomainQuotas
				})
			});
			if (res.ok) {
				const updated = await res.json();
				users = users.map((u) =>
					u.username === editingUser.username
						? {
								...u,
								maxAliases: updated.maxAliases ?? settings.defaultUserAliasQuota,
								customQuota: updated.maxAliases != null,
								domainQuotas: updated.domainQuotas ?? {}
							}
						: u
				);
				editingUser = null;
			}
		} finally {
			savingQuota = false;
		}
	}

	async function handleResetPassword() {
		if (!resettingUser || !resetNewPassword) return;
		resettingPassword = true;
		resetPasswordMsg = '';
		try {
			const res = await fetch(`/api/admin/users/${resettingUser.username}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: resetNewPassword })
			});
			if (res.ok) {
				resetPasswordMsg = 'Password updated successfully!';
				setTimeout(() => {
					resettingUser = null;
					resetNewPassword = '';
					resetPasswordMsg = '';
				}, 1200);
			} else {
				const body = await res.json();
				resetPasswordMsg = body.error ?? 'Failed to update password';
			}
		} finally {
			resettingPassword = false;
		}
	}

	async function handleDeleteUser(username: string) {
		if (username === data.currentUser?.username) {
			alert('You cannot delete your own superadmin account.');
			return;
		}
		if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

		const res = await fetch(`/api/admin/users/${username}`, { method: 'DELETE' });
		if (res.ok) {
			users = users.filter((u) => u.username !== username);
		} else {
			const body = await res.json();
			alert(body.error ?? 'Failed to delete user');
		}
	}

	// ── Domains Actions ──────────────────────────────────────────────────────
	async function handleDeleteDomain(domain: string) {
		if (!confirm(`Delete domain "${domain}" and all its aliases? This action cannot be undone.`)) return;
		const res = await fetch(`/api/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
		if (res.ok) {
			domains = domains.filter((d) => d.domain !== domain);
		} else {
			alert('Failed to delete domain');
		}
	}

	async function handleToggleDomain(d: any) {
		const res = await fetch(`/api/domains/${encodeURIComponent(d.domain)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !d.enabled })
		});
		if (res.ok) {
			const updated = await res.json();
			domains = domains.map((item) => (item.domain === d.domain ? { ...item, enabled: updated.enabled } : item));
		}
	}

	// ── DNS Blacklist Import ─────────────────────────────────────────────────
	async function handlePreviewDns() {
		if (!zoneInputText.trim()) return;
		parsingDns = true;
		dnsErrorMsg = '';
		dnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'dns_preview',
					zoneText: zoneInputText,
					domain: dnsImportDomain || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				dnsErrorMsg = body.error ?? 'Failed to parse DNS records';
			} else {
				dnsPreview = body;
				if (body.domain && !dnsImportDomain) {
					dnsImportDomain = body.domain;
				}
			}
		} catch {
			dnsErrorMsg = 'Failed to parse DNS records';
		} finally {
			parsingDns = false;
		}
	}

	async function handleConfirmDnsImport() {
		if (!zoneInputText.trim()) return;
		importingDns = true;
		dnsErrorMsg = '';
		dnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'dns_import',
					zoneText: zoneInputText,
					domain: dnsImportDomain || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				dnsErrorMsg = body.error ?? 'Failed to import DNS blacklist';
			} else {
				dnsSuccessMsg = `Successfully imported ${body.importedCount} blacklist entries!`;
				// Refresh blacklist list
				const fresh = await fetch('/api/admin/blacklist');
				if (fresh.ok) {
					blacklist = await fresh.json();
				}
				dnsPreview = null;
				zoneInputText = '';
			}
		} catch {
			dnsErrorMsg = 'Failed to import DNS blacklist';
		} finally {
			importingDns = false;
		}
	}

	// ── Cloudflare API Auto-fetch Actions ─────────────────────────────────────
	async function handleFetchCfDns() {
		if (!cfFetchDomain.trim()) return;
		fetchingCfDns = true;
		cfDnsErrorMsg = '';
		cfDnsSuccessMsg = '';
		cfDnsResult = null;
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'cf_fetch',
					domain: cfFetchDomain.trim(),
					apiToken: cfApiTokenInput.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				cfDnsErrorMsg = body.error ?? 'Failed to fetch DNS records from Cloudflare API';
			} else {
				cfDnsResult = body;
			}
		} catch {
			cfDnsErrorMsg = 'Network error while contacting Cloudflare API';
		} finally {
			fetchingCfDns = false;
		}
	}

	async function handleImportCfDns() {
		if (!cfDnsResult || !cfFetchDomain.trim()) return;
		importingCfDns = true;
		cfDnsErrorMsg = '';
		cfDnsSuccessMsg = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'cf_import',
					domain: cfFetchDomain.trim(),
					apiToken: cfApiTokenInput.trim() || undefined,
					names: cfDnsResult.extractedNames
				})
			});
			const body = await res.json();
			if (!res.ok) {
				cfDnsErrorMsg = body.error ?? 'Failed to import Cloudflare DNS blacklist';
			} else {
				cfDnsSuccessMsg = `Successfully imported ${body.importedCount} blacklist entries from Cloudflare DNS!`;
				// Refresh blacklist list
				const fresh = await fetch('/api/admin/blacklist');
				if (fresh.ok) {
					blacklist = await fresh.json();
				}
				cfDnsResult = null;
			}
		} catch {
			cfDnsErrorMsg = 'Failed to import DNS blacklist';
		} finally {
			importingCfDns = false;
		}
	}

	// ── Manual Blacklist Add / Delete ────────────────────────────────────────
	async function handleAddManual(e: Event) {
		e.preventDefault();
		if (!manualPattern.trim()) return;
		addingManual = true;
		manualError = '';
		try {
			const res = await fetch('/api/admin/blacklist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pattern: manualPattern.trim(),
					domain: manualDomain.trim() || undefined,
					description: manualDesc.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				manualError = body.error ?? 'Failed to add rule';
			} else {
				blacklist = [body, ...blacklist];
				manualPattern = '';
				manualDomain = '';
				manualDesc = '';
			}
		} catch {
			manualError = 'Network error';
		} finally {
			addingManual = false;
		}
	}

	async function handleDeleteBlacklist(id: string) {
		const res = await fetch(`/api/admin/blacklist/${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (res.ok) {
			blacklist = blacklist.filter((b) => b.id !== id);
		}
	}

	// ── Full Cloudflare Domains & DNS Sync ────────────────────────────────────
	async function handleSyncAllDomainsAndDns() {
		syncingAll = true;
		syncAllMsg = '';
		syncAllError = '';
		try {
			const res = await fetch('/api/admin/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiToken: cfTokenSettingInput.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				syncAllError = body.error ?? t('admin.sync.statusError');
			} else {
				syncAllMsg = body.status?.lastSyncMessage ?? t('admin.sync.statusSuccess');
				settings = {
					...settings,
					lastSyncStatus: body.status
				};
				if (body.domains) {
					domains = body.domains.map((d: any) => {
						const old = domains.find((item) => item.domain === d.domain);
						return {
							...d,
							aliasCount: old?.aliasCount ?? 0,
							maxAliases: 50
						};
					});
				}
				const freshBlacklist = await fetch('/api/admin/blacklist');
				if (freshBlacklist.ok) {
					blacklist = await freshBlacklist.json();
				}
				setTimeout(() => {
					syncAllMsg = '';
				}, 6000);
			}
		} catch {
			syncAllError = 'Network error while connecting to Cloudflare sync API';
		} finally {
			syncingAll = false;
		}
	}

	// ── Settings Save ────────────────────────────────────────────────────────
	async function handleSaveSettings(e: Event) {
		e.preventDefault();
		savingSettings = true;
		settingsSavedMsg = '';
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					defaultUserAliasQuota: Number(defaultQuotaInput),
					maxAliasesPerDomain: 50,
					cfApiToken: cfTokenSettingInput.trim() || null,
					autoSyncEnabled: autoSyncEnabledInput,
					autoSyncIntervalHours: Number(autoSyncIntervalInput)
				})
			});
			if (res.ok) {
				const body = await res.json();
				settings = body;
				settingsSavedMsg = t('admin.settings.savedSuccess');
				setTimeout(() => {
					settingsSavedMsg = '';
				}, 2500);
			}
		} finally {
			savingSettings = false;
		}
	}
</script>

<svelte:head>
	<title>{t('admin.title')} — MailPal</title>
</svelte:head>

<div class="min-h-screen bg-app-bg text-app-text flex flex-col">
	<!-- Top Bar -->
	<header class="border-b border-app-border bg-app-surface px-6 py-4 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<a href="/" class="p-1.5 rounded-lg hover:bg-app-hover text-app-muted hover:text-app-text transition-colors" title={t('activity.backToDashboard')}>
				<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
			</a>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-lg font-bold">{t('admin.title')}</h1>
					<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-app-accent/20 text-app-accent">
						{t('admin.superadmin')}
					</span>
				</div>
				<p class="text-xs text-app-muted">{t('admin.subtitle')}</p>
			</div>
		</div>

		<div class="flex items-center gap-3">
			<span class="text-xs text-app-muted">
				{t('sidebar.signedInAs')} <strong class="text-app-text">{data.currentUser?.username}</strong>
			</span>
			<LanguageSwitcher />
			<a
				href="/"
				class="px-3 py-1.5 rounded-lg border border-app-border bg-app-surface hover:bg-app-hover text-xs font-medium transition-colors"
			>
				{t('admin.openDashboard')}
			</a>
		</div>
	</header>

	<!-- Main Container -->
	<div class="max-w-6xl w-full mx-auto p-6 flex-1 flex flex-col">
		<!-- Navigation Tabs -->
		<div class="flex items-center gap-2 border-b border-app-border mb-6 flex-wrap">
			<button
				onclick={() => (activeTab = 'users')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'users' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
				</svg>
				{t('admin.tabs.users', { count: users.length })}
			</button>

			<button
				onclick={() => (activeTab = 'domains')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'domains' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
				</svg>
				{t('admin.tabs.domains', { count: domains.length })}
			</button>

			<button
				onclick={() => (activeTab = 'blacklist')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'blacklist' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
				</svg>
				{t('admin.tabs.blacklist', { count: blacklist.length })}
			</button>

			<button
				onclick={() => (activeTab = 'settings')}
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
					{activeTab === 'settings' ? 'border-app-accent text-app-accent' : 'border-transparent text-app-muted hover:text-app-text'}"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				{t('admin.tabs.settings')}
			</button>
		</div>

		<!-- Tab 1: Users & Quotas -->
		{#if activeTab === 'users'}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-base font-semibold">{t('admin.users.title')}</h2>
						<p class="text-xs text-app-muted">
							{t('admin.users.subtitle')}
						</p>
					</div>
					<button
						onclick={() => (showCreateUserModal = true)}
						class="px-3.5 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md"
					>
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						{t('admin.users.createUser')}
					</button>
				</div>

				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">{t('admin.users.username')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.users.role')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.users.usage')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.users.twoFactorStatus')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.users.created')}</th>
								<th class="px-4 py-3 font-semibold text-right">{t('common.actions')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each users as u (u.username)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-3.5 font-medium flex items-center gap-2">
										<div class="w-7 h-7 rounded-full bg-app-accent/15 text-app-accent flex items-center justify-center text-xs font-bold uppercase">
											{u.username.slice(0, 2)}
										</div>
										<span>{u.username}</span>
										{#if u.username === data.currentUser?.username}
											<span class="text-[10px] text-app-muted font-normal">(You)</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if u.role === 'superadmin'}
											<span class="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-400">
												{t('admin.superadmin')}
											</span>
										{:else}
											<span class="px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-300">
												USER
											</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										<div class="flex items-center gap-3">
											<div class="w-24 bg-app-hover rounded-full h-2 overflow-hidden">
												<div
													class="bg-app-accent h-full rounded-full transition-all"
													style="width: {Math.min(100, (u.aliasCount / (u.maxAliases || 1)) * 100)}%"
												></div>
											</div>
											<span class="text-xs font-mono">
												{u.aliasCount} / {u.maxAliases}
												{#if !u.customQuota}
													<span class="text-[10px] text-app-muted">(default)</span>
												{/if}
												{#if u.domainQuotas && Object.keys(u.domainQuotas).length > 0}
													<span
														class="inline-block ml-1 px-1.5 py-0.5 rounded text-[10px] bg-app-accent/15 text-app-accent font-sans"
														title={Object.entries(u.domainQuotas).map(([d, q]) => `${d}: ${q}`).join(', ')}
													>
														{Object.keys(u.domainQuotas).length} {t('admin.tabs.domains', { count: '' }).trim()}
													</span>
												{/if}
											</span>
										</div>
									</td>
									<td class="px-4 py-3.5">
										{#if u.twoFactorEnabled}
											<span class="inline-flex items-center gap-1 text-xs text-emerald-400">
												<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
												</svg>
												{t('admin.users.bound')}
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 text-xs text-amber-400">
												<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
												</svg>
												{t('admin.users.pending')}
											</span>
										{/if}
									</td>
									<td class="px-4 py-3.5 text-xs text-app-muted">
										{new Date(u.createdAt).toLocaleDateString()}
									</td>
									<td class="px-4 py-3.5 text-right space-x-2">
										<button
											onclick={() => {
												editingUser = u;
												editQuotaValue = u.customQuota ? u.maxAliases : '';
												editDomainQuotas = { ...(u.domainQuotas ?? {}) };
											}}
											class="text-xs text-app-accent hover:underline"
										>
											{t('admin.users.editQuota')}
										</button>

										<button
											onclick={() => {
												resettingUser = u;
												resetNewPassword = '';
											}}
											class="text-xs text-app-muted hover:text-app-text"
										>
											{t('admin.users.resetPassword')}
										</button>

										{#if u.username !== data.currentUser?.username}
											<button
												onclick={() => handleDeleteUser(u.username)}
												class="text-xs text-red-400 hover:text-red-300"
											>
												{t('common.delete')}
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 2: Domains -->
		{#if activeTab === 'domains'}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-base font-semibold">{t('admin.domains.title')}</h2>
						<p class="text-xs text-app-muted">
							{t('admin.domains.subtitle')}
						</p>
					</div>
				</div>

				<!-- Cloudflare Domains & DNS Auto-Sync Card -->
				<div class="bg-app-surface border border-orange-500/30 rounded-xl p-4 shadow flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<svg class="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
								<path d="M18.8 9.5a5.5 5.5 0 00-10.6-1.5A5.002 5.002 0 003 13c0 2.76 2.24 5 5 5h10.5a4.5 4.5 0 00.3-9z" />
							</svg>
							<span class="text-xs font-bold text-app-text">{t('admin.sync.title')}</span>
							{#if settings.lastSyncStatus}
								<span class="px-2 py-0.5 rounded text-[10px] font-semibold {settings.lastSyncStatus.lastSyncResult === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}">
									{settings.lastSyncStatus.lastSyncResult === 'success' ? t('admin.sync.statusSuccess') : t('admin.sync.statusError')}
								</span>
							{/if}
						</div>
						<div class="text-xs text-app-muted">
							<span>{t('admin.sync.lastSync')}</span>
							<span class="font-mono text-app-text">
								{settings.lastSyncStatus?.lastSyncTime ? new Date(settings.lastSyncStatus.lastSyncTime).toLocaleString() : t('admin.sync.neverSynced')}
							</span>
							{#if settings.lastSyncStatus?.lastSyncResult === 'success'}
								<span class="mx-1.5 text-app-border">·</span>
								<span class="text-emerald-400">
									{t('admin.sync.statZones', { count: settings.lastSyncStatus.syncedZonesCount })} · {t('admin.sync.statNewDomains', { count: settings.lastSyncStatus.newDomainsAddedCount })} · {t('admin.sync.statDnsRules', { count: settings.lastSyncStatus.syncedDnsRulesCount })}
								</span>
							{/if}
						</div>
						{#if syncAllMsg}
							<p class="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded">{syncAllMsg}</p>
						{/if}
						{#if syncAllError}
							<p class="text-xs text-red-400 bg-red-500/10 px-2.5 py-1 rounded">{syncAllError}</p>
						{/if}
					</div>

					<button
						type="button"
						onclick={handleSyncAllDomainsAndDns}
						disabled={syncingAll}
						class="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 text-xs font-semibold transition-all disabled:opacity-50"
					>
						<svg class="w-3.5 h-3.5 {syncingAll ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						{syncingAll ? t('admin.sync.syncing') : t('admin.sync.syncAllBtn')}
					</button>
				</div>

				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">{t('admin.domains.domain')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.domains.owner')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.domains.aliasLimit')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.domains.defaultTarget')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.domains.wildcard')}</th>
								<th class="px-4 py-3 font-semibold">{t('common.status')}</th>
								<th class="px-4 py-3 font-semibold text-right">{t('common.actions')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each domains as d (d.domain)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-3.5 font-medium">
										<a href="/domains/{d.domain}" class="hover:text-app-accent transition-colors flex items-center gap-1.5">
											<span class="w-2 h-2 rounded-full" style="background-color: {d.color || '#3b82f6'}"></span>
											{d.domain}
										</a>
									</td>
									<td class="px-4 py-3.5 text-xs">
										{#if d.ownerUsername}
											<span class="font-mono bg-app-hover px-2 py-0.5 rounded border border-app-border">
												{d.ownerUsername}
											</span>
										{:else}
											<span class="text-app-muted italic">{t('admin.domains.unassigned')}</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										<div class="flex items-center gap-3">
											<div class="w-24 bg-app-hover rounded-full h-2 overflow-hidden">
												<div
													class="h-full rounded-full transition-all {d.aliasCount >= 50 ? 'bg-red-500' : 'bg-app-accent'}"
													style="width: {(d.aliasCount / 50) * 100}%"
												></div>
											</div>
											<span class="text-xs font-mono {d.aliasCount >= 50 ? 'text-red-400 font-bold' : ''}">
												{d.aliasCount} / 50
											</span>
										</div>
									</td>
									<td class="px-4 py-3.5 text-xs text-app-muted truncate max-w-[150px]">
										{d.targetEmail}
									</td>
									<td class="px-4 py-3.5 text-xs">
										{d.wildcardEnabled ? t('common.enabled') : t('common.disabled')}
									</td>
									<td class="px-4 py-3.5">
										<button
											onclick={() => handleToggleDomain(d)}
											class="text-xs px-2 py-0.5 rounded {d.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}"
										>
											{d.enabled ? t('common.active') : t('common.disabled')}
										</button>
									</td>
									<td class="px-4 py-3.5 text-right space-x-2">
										<a
											href="/domains/{d.domain}"
											class="text-xs text-app-accent hover:underline"
										>
											{t('admin.domains.viewAliases')}
										</a>
										<button
											onclick={() => handleDeleteDomain(d.domain)}
											class="text-xs text-red-400 hover:text-red-300"
										>
											{t('common.delete')}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 3: Blacklist & DNS Import -->
		{#if activeTab === 'blacklist'}
			<div class="space-y-6">
				<!-- Cloudflare API Auto-Sync Card -->
				<div class="bg-app-surface border border-orange-500/30 rounded-xl p-6 shadow relative overflow-hidden">
					<div class="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/5 rounded-full blur-2xl pointer-events-none"></div>

					<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
						<div>
							<div class="flex items-center gap-2">
								<svg class="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
									<path d="M18.8 9.5a5.5 5.5 0 00-10.6-1.5A5.002 5.002 0 003 13c0 2.76 2.24 5 5 5h10.5a4.5 4.5 0 00.3-9z" />
								</svg>
								<h3 class="text-sm font-bold text-app-text">{t('admin.blacklist.cfTitle')}</h3>
								<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
									{t('admin.blacklist.cfBadge')}
								</span>
							</div>
							<p class="text-xs text-app-muted mt-1">
								{t('admin.blacklist.cfDesc')}
							</p>
						</div>

						<button
							type="button"
							onclick={handleSyncAllDomainsAndDns}
							disabled={syncingAll}
							class="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-xs font-semibold transition-all disabled:opacity-50"
						>
							<svg class="w-3.5 h-3.5 {syncingAll ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							{syncingAll ? t('admin.sync.syncing') : t('admin.sync.syncAllBtn')}
						</button>
					</div>

					{#if syncAllMsg}
						<div class="mb-3 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
							{syncAllMsg}
						</div>
					{/if}
					{#if syncAllError}
						<div class="mb-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">
							{syncAllError}
						</div>
					{/if}

					<div class="space-y-4">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label for="cf-fetch-domain" class="block text-xs font-medium text-app-text mb-1">{t('admin.blacklist.selectDomain')}</label>
								<div class="relative">
									{#if domains.length > 0}
										<select
											id="cf-fetch-domain"
											bind:value={cfFetchDomain}
											class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-orange-500"
										>
											{#each domains as d}
												<option value={d.domain}>{d.domain}</option>
											{/each}
										</select>
									{:else}
										<input
											id="cf-fetch-domain"
											type="text"
											bind:value={cfFetchDomain}
											placeholder="e.g. wled.top"
											class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-orange-500"
										/>
									{/if}
								</div>
							</div>

							<div>
								<label for="cf-api-token" class="block text-xs font-medium text-app-text mb-1">
									{t('admin.blacklist.tokenLabel')}
									{#if data.hasEnvCfToken}
										<span class="text-[11px] text-emerald-400 font-normal">{t('admin.blacklist.tokenEnvDetected')}</span>
									{:else if settings.cfApiToken}
										<span class="text-[11px] text-emerald-400 font-normal">{t('admin.blacklist.tokenGlobalDetected')}</span>
									{:else}
										<span class="text-[11px] text-amber-400 font-normal">{t('admin.blacklist.tokenNeedInput')}</span>
									{/if}
								</label>
								<input
									id="cf-api-token"
									type="password"
									bind:value={cfApiTokenInput}
									placeholder={data.hasEnvCfToken || settings.cfApiToken ? t('admin.blacklist.tokenPlaceholder') : '输入 Cloudflare API Token...'}
									class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text font-mono outline-none focus:border-orange-500"
								/>
							</div>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-xs text-app-muted">
								{t('admin.blacklist.tokenPerms')}
							</span>
							<button
								type="button"
								onclick={handleFetchCfDns}
								disabled={fetchingCfDns || !cfFetchDomain.trim()}
								class="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow disabled:opacity-50"
							>
								{#if fetchingCfDns}
									<svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
									</svg>
									{t('admin.blacklist.fetching')}
								{:else}
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
									</svg>
									{t('admin.blacklist.fetchBtn')}
								{/if}
							</button>
						</div>

						{#if cfDnsErrorMsg}
							<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{cfDnsErrorMsg}</p>
						{/if}
						{#if cfDnsSuccessMsg}
							<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{cfDnsSuccessMsg}</p>
						{/if}

						{#if cfDnsResult}
							<div class="p-4 rounded-lg bg-app-hover/80 border border-orange-500/30 space-y-3">
								<div class="flex items-center justify-between text-xs">
									<div class="text-app-muted">
										{t('admin.blacklist.zoneInfo', { name: cfDnsResult.zoneName, id: cfDnsResult.zoneId.slice(0, 8), records: cfDnsResult.totalRecords, count: cfDnsResult.extractedNames.length })}
									</div>
									<button
										type="button"
										onclick={handleImportCfDns}
										disabled={importingCfDns || cfDnsResult.extractedNames.length === 0}
										class="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-all disabled:opacity-50 shadow"
									>
										{importingCfDns ? t('admin.blacklist.importing') : t('admin.blacklist.importBtn', { count: cfDnsResult.extractedNames.length })}
									</button>
								</div>

								<div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-app-surface/60 rounded border border-app-border">
									{#each cfDnsResult.extractedNames as name}
										<span class="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-xs font-mono text-orange-300">
											{name}
										</span>
									{/each}
									{#if cfDnsResult.extractedNames.length === 0}
										<span class="text-xs text-app-muted italic p-1">{t('admin.blacklist.noSubdomains')}</span>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- DNS Zone File Importer Card (Manual Fallback) -->
				<div class="bg-app-surface border border-app-border rounded-xl p-6 shadow">
					<div class="flex items-start justify-between mb-4">
						<div>
							<h3 class="text-sm font-bold flex items-center gap-2">
								<svg class="w-4 h-4 text-app-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
								</svg>
								{t('admin.blacklist.zoneFileTitle')}
							</h3>
							<p class="text-xs text-app-muted mt-1">
								{t('admin.blacklist.zoneFileDesc')}
							</p>
						</div>
					</div>

					<div class="space-y-3">
						<textarea
							bind:value={zoneInputText}
							rows="6"
							class="w-full p-3 font-mono text-xs rounded-lg border border-app-border bg-app-hover text-app-text placeholder:text-app-muted/60 focus:outline-none focus:border-app-accent"
							placeholder={t('admin.blacklist.zonePlaceholder')}
						></textarea>

						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<label for="scope-domain" class="text-xs text-app-muted">{t('admin.blacklist.scopeDomain')}</label>
								<input
									id="scope-domain"
									type="text"
									bind:value={dnsImportDomain}
									placeholder={t('admin.blacklist.scopePlaceholder')}
									class="px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
								/>
							</div>

							<div class="flex items-center gap-2">
								<button
									onclick={handlePreviewDns}
									disabled={parsingDns || !zoneInputText.trim()}
									class="px-3 py-1.5 rounded-lg border border-app-border bg-app-hover hover:bg-app-border text-xs font-medium transition-colors disabled:opacity-50"
								>
									{parsingDns ? t('admin.blacklist.parsing') : t('admin.blacklist.previewBtn')}
								</button>
								{#if dnsPreview}
									<button
										onclick={handleConfirmDnsImport}
										disabled={importingDns}
										class="px-3.5 py-1.5 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold transition-all disabled:opacity-50 shadow"
									>
										{importingDns ? t('admin.blacklist.importing') : t('admin.blacklist.importZoneBtn', { count: dnsPreview.names.length })}
									</button>
								{/if}
							</div>
						</div>

						{#if dnsErrorMsg}
							<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{dnsErrorMsg}</p>
						{/if}
						{#if dnsSuccessMsg}
							<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{dnsSuccessMsg}</p>
						{/if}

						{#if dnsPreview}
							<div class="mt-3 p-3 rounded-lg bg-app-hover/70 border border-app-border/80">
								<div class="text-xs text-app-muted mb-2">
									{t('admin.blacklist.zonePreviewInfo', { domain: dnsPreview.domain || t('admin.blacklist.globalScope'), names: dnsPreview.names.length, total: dnsPreview.totalRecords })}
								</div>
								<div class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
									{#each dnsPreview.names as name}
										<span class="px-2 py-0.5 rounded bg-app-surface border border-app-border text-xs font-mono text-app-text">
											{name}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Manual Blacklist Rule Add -->
				<div class="bg-app-surface border border-app-border rounded-xl p-6 shadow">
					<h3 class="text-sm font-bold mb-1">{t('admin.blacklist.manualTitle')}</h3>
					<p class="text-xs text-app-muted mb-4">
						{t('admin.blacklist.manualDesc')}
					</p>

					<form onsubmit={handleAddManual} class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
						<div>
							<label for="manual-pattern" class="block text-xs font-medium text-app-text mb-1">{t('admin.blacklist.patternLabel')}</label>
							<input
								id="manual-pattern"
								bind:value={manualPattern}
								required
								placeholder={t('admin.blacklist.patternPlaceholder')}
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<label for="manual-domain" class="block text-xs font-medium text-app-text mb-1">{t('admin.blacklist.domainLabel')}</label>
							<input
								id="manual-domain"
								bind:value={manualDomain}
								placeholder={t('admin.blacklist.domainPlaceholder')}
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<label for="manual-desc" class="block text-xs font-medium text-app-text mb-1">{t('admin.blacklist.descLabel')}</label>
							<input
								id="manual-desc"
								bind:value={manualDesc}
								placeholder={t('admin.blacklist.descPlaceholder')}
								class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
							/>
						</div>
						<div>
							<button
								type="submit"
								disabled={addingManual}
								class="w-full py-2 px-3 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold transition-all disabled:opacity-50"
							>
								{addingManual ? t('admin.blacklist.adding') : t('admin.blacklist.addRuleBtn')}
							</button>
						</div>
					</form>
					{#if manualError}
						<p class="text-xs text-red-400 mt-2">{manualError}</p>
					{/if}
				</div>

				<!-- Blacklist Table -->
				<div class="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow">
					<table class="w-full text-left text-sm">
						<thead class="bg-app-hover/50 text-xs text-app-muted uppercase tracking-wider border-b border-app-border">
							<tr>
								<th class="px-4 py-3 font-semibold">{t('admin.blacklist.tableBlocked')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.blacklist.tableScope')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.blacklist.tableSource')}</th>
								<th class="px-4 py-3 font-semibold">{t('admin.blacklist.tableDesc')}</th>
								<th class="px-4 py-3 font-semibold text-right">{t('common.actions')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-app-border/50">
							{#each blacklist as item (item.id)}
								<tr class="hover:bg-app-hover/30 transition-colors">
									<td class="px-4 py-2.5 font-mono text-xs font-semibold text-red-400">
										{item.pattern}
									</td>
									<td class="px-4 py-2.5 text-xs text-app-muted">
										{item.domain || t('admin.blacklist.globalScope')}
									</td>
									<td class="px-4 py-2.5 text-xs">
										<span class="px-1.5 py-0.5 rounded text-[11px] {item.source === 'cloudflare_api' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium' : item.source === 'dns_import' ? 'bg-sky-500/20 text-sky-400' : 'bg-purple-500/20 text-purple-400'}">
											{item.source === 'cloudflare_api' ? t('admin.blacklist.sourceCf') : item.source === 'dns_import' ? t('admin.blacklist.sourceZone') : t('admin.blacklist.sourceManual')}
										</span>
									</td>
									<td class="px-4 py-2.5 text-xs text-app-muted truncate max-w-[200px]">
										{item.description || '—'}
									</td>
									<td class="px-4 py-2.5 text-right">
										<button
											onclick={() => handleDeleteBlacklist(item.id)}
											class="text-xs text-red-400 hover:text-red-300"
										>
											{t('common.delete')}
										</button>
									</td>
								</tr>
							{/each}
							{#if blacklist.length === 0}
								<tr>
									<td colspan="5" class="px-4 py-6 text-center text-xs text-app-muted italic">
										{t('admin.blacklist.noRules')}
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Tab 4: System Settings -->
		{#if activeTab === 'settings'}
			<div class="max-w-xl bg-app-surface border border-app-border rounded-xl p-6 shadow space-y-6">
				<div>
					<h2 class="text-base font-semibold">{t('admin.settings.title')}</h2>
					<p class="text-xs text-app-muted mt-0.5">{t('admin.settings.subtitle')}</p>
				</div>

				<form onsubmit={handleSaveSettings} class="space-y-4">
					<div>
						<label for="default-quota" class="block text-sm font-medium text-app-text mb-1">
							{t('admin.settings.defaultQuota')}
						</label>
						<input
							id="default-quota"
							type="number"
							min="1"
							bind:value={defaultQuotaInput}
							required
							class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
						/>
						<p class="text-xs text-app-muted mt-1">
							{t('admin.settings.defaultQuotaDesc')}
						</p>
					</div>

					<div>
						<label for="cf-token-setting" class="block text-sm font-medium text-app-text mb-1">
							{t('admin.settings.cfToken')}
						</label>
						<input
							id="cf-token-setting"
							type="password"
							bind:value={cfTokenSettingInput}
							placeholder="cf_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
							class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm font-mono text-app-text outline-none focus:border-app-accent"
						/>
						<p class="text-xs text-app-muted mt-1">
							{#if data.hasEnvCfToken}
								<span class="text-emerald-400 font-medium">{t('admin.settings.cfTokenEnvDetected')}</span>
							{:else}
								{t('admin.settings.cfTokenDesc')}
							{/if}
						</p>
					</div>

					<!-- Cloudflare Auto-Sync Settings -->
					<div class="p-4 rounded-lg bg-app-hover/30 border border-app-border space-y-3">
						<div class="flex items-center justify-between">
							<div>
								<div class="text-sm font-medium text-app-text">{t('admin.sync.autoSyncLabel')}</div>
								<p class="text-xs text-app-muted mt-0.5">{t('admin.sync.autoSyncDesc')}</p>
							</div>
							<label class="relative inline-flex items-center cursor-pointer">
								<input
									type="checkbox"
									bind:checked={autoSyncEnabledInput}
									class="sr-only peer"
								/>
								<div class="w-9 h-5 bg-app-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-accent"></div>
							</label>
						</div>

						{#if autoSyncEnabledInput}
							<div>
								<label for="auto-sync-interval" class="block text-xs font-medium text-app-text mb-1">
									{t('admin.sync.intervalLabel')}
								</label>
								<select
									id="auto-sync-interval"
									bind:value={autoSyncIntervalInput}
									class="w-full px-3 py-2 text-xs rounded-lg border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
								>
									<option value={1}>{t('admin.sync.interval1h')}</option>
									<option value={6}>{t('admin.sync.interval6h')}</option>
									<option value={12}>{t('admin.sync.interval12h')}</option>
									<option value={24}>{t('admin.sync.interval24h')}</option>
								</select>
							</div>
						{/if}

						<div class="pt-2 border-t border-app-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
							<div class="text-xs text-app-muted">
								<span>{t('admin.sync.lastSync')}</span>
								<span class="font-mono text-app-text">
									{settings.lastSyncStatus?.lastSyncTime ? new Date(settings.lastSyncStatus.lastSyncTime).toLocaleString() : t('admin.sync.neverSynced')}
								</span>
							</div>

							<button
								type="button"
								onclick={handleSyncAllDomainsAndDns}
								disabled={syncingAll}
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-xs font-semibold transition-all disabled:opacity-50"
							>
								<svg class="w-3.5 h-3.5 {syncingAll ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
								{syncingAll ? t('admin.sync.syncing') : t('admin.sync.syncAllBtn')}
							</button>
						</div>

						{#if syncAllMsg}
							<p class="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded">{syncAllMsg}</p>
						{/if}
						{#if syncAllError}
							<p class="text-xs text-red-400 bg-red-500/10 px-2.5 py-1 rounded">{syncAllError}</p>
						{/if}
					</div>

					<div class="p-4 rounded-lg bg-app-hover/50 border border-app-border">
						<div class="text-sm font-medium text-app-text">{t('admin.settings.maxPerDomain')}</div>
						<div class="text-2xl font-bold font-mono text-app-accent mt-1">50</div>
						<p class="text-xs text-app-muted mt-1">
							{t('admin.settings.maxPerDomainDesc')}
						</p>
					</div>

					{#if settingsSavedMsg}
						<p class="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg">{settingsSavedMsg}</p>
					{/if}

					<button
						type="submit"
						disabled={savingSettings}
						class="py-2 px-4 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold transition-all disabled:opacity-50"
					>
						{savingSettings ? t('admin.users.savingQuota') : t('admin.settings.saveSettings')}
					</button>
				</form>
			</div>
		{/if}
	</div>
</div>

<!-- Modal: Create User -->
{#if showCreateUserModal}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
			<h3 class="text-base font-bold mb-1">{t('admin.users.createTitle')}</h3>
			<p class="text-xs text-app-muted mb-4">
				{t('admin.users.createSubtitle')}
			</p>

			<form onsubmit={handleCreateUser} class="space-y-4">
				<div>
					<label for="create-username" class="block text-xs font-medium text-app-text mb-1">{t('admin.users.newUsername')}</label>
					<input
						id="create-username"
						type="text"
						required
						bind:value={newUsername}
						placeholder="e.g. alice"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				<div>
					<label for="create-password" class="block text-xs font-medium text-app-text mb-1">{t('admin.users.initialPassword')}</label>
					<input
						id="create-password"
						type="password"
						required
						minlength="8"
						bind:value={newPassword}
						placeholder="••••••••••••"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				<div>
					<label for="create-max-aliases" class="block text-xs font-medium text-app-text mb-1">{t('admin.users.aliasQuotaOptional')}</label>
					<input
						id="create-max-aliases"
						type="number"
						min="1"
						bind:value={newMaxAliases}
						placeholder={t('admin.users.aliasQuotaPlaceholder', { count: settings.defaultUserAliasQuota })}
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				{#if createUserError}
					<p class="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded">{createUserError}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (showCreateUserModal = false)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						{t('common.cancel')}
					</button>
					<button
						type="submit"
						disabled={creatingUser}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{creatingUser ? t('admin.users.creatingAccount') : t('admin.users.createAccountBtn')}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Modal: Edit Quota -->
{#if editingUser}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] flex flex-col">
			<h3 class="text-base font-bold mb-1">{t('admin.users.editQuotaTitle')}</h3>
			<p class="text-xs text-app-muted mb-4">
				{t('admin.users.editQuotaSubtitle', { username: editingUser.username })}
			</p>

			<div class="space-y-4 overflow-y-auto flex-1 pr-1">
				<div>
					<label for="edit-quota-value" class="block text-xs font-medium text-app-text mb-1">
						{t('admin.users.customQuotaLabel')}
					</label>
					<input
						id="edit-quota-value"
						type="number"
						min="0"
						bind:value={editQuotaValue}
						placeholder={t('admin.users.aliasQuotaPlaceholder', { count: settings.defaultUserAliasQuota })}
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
					<p class="text-[11px] text-app-muted mt-1">{t('admin.users.currentlyUsed', { count: editingUser.aliasCount })}</p>
				</div>

				{#if domains.length > 0}
					<div class="border-t border-app-border/50 pt-3">
						<h4 class="text-xs font-semibold text-app-text mb-1">
							{t('admin.users.domainQuotaTitle')}
						</h4>
						<p class="text-[11px] text-app-muted mb-3">
							{t('admin.users.domainQuotaSubtitle')}
						</p>

						<div class="space-y-2 max-h-48 overflow-y-auto pr-1">
							{#each domains as d (d.domain)}
								<div class="flex items-center justify-between gap-3 bg-app-hover/30 p-2 rounded-lg border border-app-border/40">
									<div class="min-w-0 flex-1">
										<div class="text-xs font-mono font-medium truncate text-app-text">@{d.domain}</div>
										<div class="text-[10px] text-app-muted">
											{t('admin.users.currentlyUsed', { count: editingUser.domainUsage?.[d.domain] ?? 0 })}
										</div>
									</div>
									<div class="w-24 shrink-0">
										<input
											type="number"
											min="0"
											bind:value={editDomainQuotas[d.domain]}
											placeholder={t('admin.users.domainQuotaInherit')}
											class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-hover text-app-text outline-none focus:border-app-accent"
										/>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2 border-t border-app-border/50">
					<button
						type="button"
						onclick={() => (editingUser = null)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						onclick={handleSaveQuota}
						disabled={savingQuota}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{savingQuota ? t('admin.users.savingQuota') : t('admin.users.saveQuotaBtn')}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Reset Password -->
{#if resettingUser}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-app-surface border border-app-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
			<h3 class="text-base font-bold mb-1">{t('admin.users.resetPasswordTitle')}</h3>
			<p class="text-xs text-app-muted mb-4">
				{t('admin.users.resetPasswordSubtitle', { username: resettingUser.username })}
			</p>

			<div class="space-y-4">
				<div>
					<label for="reset-new-password" class="block text-xs font-medium text-app-text mb-1">
						{t('admin.users.newPasswordLabel')}
					</label>
					<input
						id="reset-new-password"
						type="password"
						minlength="8"
						bind:value={resetNewPassword}
						placeholder="••••••••••••"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text outline-none focus:border-app-accent"
					/>
				</div>

				{#if resetPasswordMsg}
					<p class="text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded">{resetPasswordMsg}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={() => (resettingUser = null)}
						class="px-3 py-2 rounded-lg text-xs text-app-muted hover:text-app-text"
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						onclick={handleResetPassword}
						disabled={resettingPassword || !resetNewPassword}
						class="px-4 py-2 rounded-lg bg-app-accent hover:brightness-110 text-app-bg text-xs font-semibold shadow disabled:opacity-50"
					>
						{resettingPassword ? t('admin.users.updatingPassword') : t('admin.users.updatePasswordBtn')}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
