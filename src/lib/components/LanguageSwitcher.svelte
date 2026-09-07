<script lang="ts">
	import { getLocale, setLocale, t } from '$lib/i18n/index.js';

	let { class: className = '' }: { class?: string } = $props();

	function toggleLanguage() {
		const next = getLocale() === 'zh' ? 'en' : 'zh';
		setLocale(next);
	}
</script>

<button
	type="button"
	onclick={toggleLanguage}
	class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-app-border bg-app-surface hover:bg-app-hover text-xs font-medium text-app-muted hover:text-app-text transition-all shadow-sm {className}"
	title={t('lang.switchLanguage')}
	aria-label={t('lang.switchLanguage')}
>
	<svg class="w-3.5 h-3.5 text-app-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
		/>
	</svg>
	<span class="font-sans">
		{getLocale() === 'zh' ? '中文' : 'EN'}
	</span>
</button>
