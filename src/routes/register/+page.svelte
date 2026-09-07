<script lang="ts">
	import type { ActionData } from './$types';
	import { t } from '$lib/i18n/index.js';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{t('auth.registerTitle')} — MailPal</title>
</svelte:head>

<div class="min-h-screen flex flex-col items-center justify-center bg-app-bg p-4 relative">
	<div class="absolute top-4 right-4">
		<LanguageSwitcher />
	</div>

	<div class="w-full max-w-md">
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
							d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
						/>
					</svg>
				</div>
				<h1 class="text-xl font-bold text-app-text">{t('auth.registerTitle')}</h1>
				<p class="text-xs text-app-muted mt-1.5 leading-relaxed">
					{t('auth.registerSubtitle')}
				</p>
			</div>

			<form method="POST" class="space-y-4">
				<div>
					<label for="username" class="block text-xs font-medium text-app-text mb-1.5">
						{t('auth.username')} *
					</label>
					<input
						id="username"
						name="username"
						type="text"
						required
						autocomplete="username"
						class="w-full px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
						placeholder="e.g. admin"
					/>
				</div>

				<div>
					<label for="password" class="block text-xs font-medium text-app-text mb-1.5">
						{t('auth.passwordMinChars')} *
					</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
						class="w-full px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
						placeholder="••••••••••••"
					/>
				</div>

				<div>
					<label for="confirmPassword" class="block text-xs font-medium text-app-text mb-1.5">
						{t('auth.confirmPassword')} *
					</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
						class="w-full px-3 py-2.5 rounded-lg border border-app-border bg-app-hover text-sm text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent/60 transition-colors"
						placeholder="••••••••••••"
					/>
				</div>

				{#if form?.error}
					<p class="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{form.error}</p>
				{/if}

				<div class="pt-2">
					<button
						type="submit"
						class="w-full py-2.5 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-app-accent/20"
					>
						{t('auth.createSuperadmin')}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
						</svg>
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
