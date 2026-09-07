<script lang="ts">
	import type { ActionData } from './$types';
	import { t } from '$lib/i18n/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';

	let { form }: { form: ActionData } = $props();

	let usernameInput = $state('');
	let passwordInput = $state('');
	let totpInput = $state('');

	let show2FaStep = $derived(Boolean(form?.requires2Fa));
	let effectiveUsername = $derived(form?.username || usernameInput);
</script>

<svelte:head>
	<title>{t('auth.signIn')} — MailPal</title>
</svelte:head>

<div class="min-h-screen flex flex-col items-center justify-center bg-app-bg p-4 relative">
	<div class="absolute top-4 right-4">
		<LanguageSwitcher />
	</div>

	<div class="w-full max-w-sm">
		<div class="bg-app-surface border border-app-border rounded-2xl shadow-2xl p-8">
			<div class="mb-8 text-center">
				<div
					class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-app-accent/15 mb-4"
				>
					<svg
						class="w-6 h-6 text-app-accent"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<h1 class="text-2xl font-bold text-app-text">MailPal</h1>
				<p class="text-sm text-app-muted mt-1">Email alias manager</p>
			</div>

			<form method="POST" class="space-y-4">
				{#if !show2FaStep}
					<!-- Step 1: Username & Password -->
					<div>
						<label for="username" class="block text-sm font-medium text-app-text mb-1.5">
							{t('auth.username')}
						</label>
						<input
							id="username"
							name="username"
							type="text"
							required
							autocomplete="username"
							bind:value={usernameInput}
							class="w-full px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
							placeholder={t('auth.username')}
						/>
					</div>

					<div>
						<label for="password" class="block text-sm font-medium text-app-text mb-1.5">
							{t('auth.password')}
						</label>
						<input
							id="password"
							name="password"
							type="password"
							required
							autocomplete="current-password"
							bind:value={passwordInput}
							class="w-full px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
							placeholder={t('auth.password')}
						/>
					</div>

					{#if form?.error}
						<p class="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{form.error}</p>
					{/if}

					<button
						type="submit"
						class="w-full py-2.5 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg transition-all"
					>
						{t('auth.signIn')}
					</button>
				{:else}
					<!-- Step 2: 2FA Verification Code -->
					<input type="hidden" name="username" value={effectiveUsername} />
					<input type="hidden" name="password" value={passwordInput} />

					<div class="text-center mb-2">
						<div class="text-xs text-app-muted">{t('auth.signingInAs')}</div>
						<div class="font-medium text-app-text">{effectiveUsername}</div>
					</div>

					<div>
						<label for="totpCode" class="block text-sm font-medium text-app-text mb-1.5 text-center">
							{t('auth.totpCode')}
						</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="totpCode"
							name="totpCode"
							type="text"
							inputmode="numeric"
							maxlength="10"
							required
							autocomplete="one-time-code"
							autofocus
							bind:value={totpInput}
							oninput={(e) => {
								const target = e.target as HTMLInputElement;
								const cleaned = target.value
									.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
									.replace(/\D/g, '')
									.slice(0, 6);
								totpInput = cleaned;
								target.value = cleaned;
							}}
							class="w-full text-center text-xl font-mono tracking-widest px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
							placeholder="000000"
						/>
					</div>

					{#if form?.error}
						<p class="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2 text-center">{form.error}</p>
					{/if}

					<button
						type="submit"
						class="w-full py-2.5 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg transition-all"
					>
						{t('auth.verifyAndSignIn')}
					</button>

					<div class="text-center pt-2">
						<a
							href="/login"
							class="text-xs text-app-muted hover:text-app-text transition-colors"
						>
							← {t('common.back')}
						</a>
					</div>
				{/if}
			</form>
		</div>
	</div>
</div>
