<script lang="ts">
	import type { AliasConfig } from '$lib/types.js';
	import { t } from '$lib/i18n';

	let { aliases }: { aliases: AliasConfig[] } = $props();

	const totalAliases = $derived(aliases.length);
	const activeAliases = $derived(aliases.filter((a) => a.enabled).length);
	const totalForwarded = $derived(aliases.reduce((s, a) => s + a.forwardedCount, 0));
	const totalBlocked = $derived(aliases.reduce((s, a) => s + a.blockedCount, 0));

	function fmt(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 10_000) return `${Math.round(n / 1000)}k`;
		if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
		return n.toString();
	}

	const stats = $derived([
		{ key: 'total', label: t('dashboard.stats.total'), value: fmt(totalAliases), title: totalAliases.toString() },
		{ key: 'active', label: t('dashboard.stats.active'), value: fmt(activeAliases), title: activeAliases.toString() },
		{ key: 'forwarded', label: t('dashboard.stats.forwarded'), value: fmt(totalForwarded), title: totalForwarded.toString() },
		{ key: 'blocked', label: t('dashboard.stats.blocked'), value: fmt(totalBlocked), title: totalBlocked.toString() },
	]);
</script>

<dl
	class="grid grid-cols-4 divide-x divide-app-border rounded-xl border border-app-border bg-app-surface overflow-hidden"
	aria-label="Overview statistics"
>
	{#each stats as stat (stat.key)}
		<div class="px-4 py-3 flex items-center justify-start gap-2">
			<dd class="text-lg font-bold text-app-text tabular-nums leading-tight" title={stat.title}>{stat.value}</dd>
			<dt class="text-[11px] text-app-muted uppercase tracking-wide leading-none">{stat.label}</dt>
		</div>
	{/each}
</dl>
