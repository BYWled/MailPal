<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let copied = $state(false);

	function copySecret() {
		navigator.clipboard.writeText(data.secret);
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 2000);
	}
</script>

<svelte:head>
	<title>Mandatory 2FA Setup — MailPal</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-app-bg p-4">
	<div class="w-full max-w-lg">
		<div class="bg-app-surface border border-app-border rounded-2xl shadow-2xl p-8">
			<div class="text-center mb-6">
				<div
					class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-app-accent/15 mb-3"
				>
					<svg
						class="w-6 h-6 text-app-accent"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
				</div>
				<h1 class="text-2xl font-bold text-app-text">Two-Factor Authentication</h1>
				<p class="text-sm text-app-muted mt-1">
					2FA is <span class="text-amber-400 font-medium">mandatory</span> for all accounts to ensure system security.
				</p>
			</div>

			<!-- QR Code display -->
			<div class="flex flex-col items-center mb-6">
				<div class="p-3 bg-white rounded-xl shadow-inner inline-block">
					{@html data.qrSvg}
				</div>
				<p class="text-xs text-app-muted mt-2 text-center max-w-xs">
					Scan this QR code with Google Authenticator, Microsoft Authenticator, or 1Password.
				</p>
			</div>

			<!-- Manual entry key -->
			<div class="mb-6 p-3 rounded-lg bg-app-hover border border-app-border">
				<div class="flex items-center justify-between text-xs text-app-muted mb-1">
					<span>Can't scan? Enter key manually:</span>
					<button
						type="button"
						onclick={copySecret}
						class="text-app-accent hover:underline focus:outline-none"
					>
						{copied ? 'Copied!' : 'Copy Key'}
					</button>
				</div>
				<div class="font-mono text-sm tracking-wider text-app-text select-all break-all">
					{data.secret}
				</div>
			</div>

			<!-- Verification form -->
			<form method="POST" class="space-y-4">
				<div>
					<label for="code" class="block text-sm font-medium text-app-text mb-1.5 text-center">
						Enter 6-Digit Authenticator Code
					</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="code"
						name="code"
						type="text"
						inputmode="numeric"
						pattern="[0-9]{6}"
						maxlength="6"
						required
						autocomplete="one-time-code"
						autofocus
						class="w-full text-center text-2xl font-mono tracking-widest px-4 py-3 rounded-xl border border-app-border bg-app-hover text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
						placeholder="000000"
					/>
				</div>

				{#if form?.error}
					<p class="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2 text-center">{form.error}</p>
				{/if}

				<button
					type="submit"
					class="w-full py-2.5 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg transition-all shadow-lg shadow-app-accent/20"
				>
					Verify & Activate 2FA
				</button>
			</form>

			<div class="mt-4 pt-4 border-t border-app-border text-center">
				<form method="POST" action="/logout">
					<button type="submit" class="text-xs text-app-muted hover:text-red-400 transition-colors">
						Cancel & Sign Out
					</button>
				</form>
			</div>
		</div>
	</div>
</div>
