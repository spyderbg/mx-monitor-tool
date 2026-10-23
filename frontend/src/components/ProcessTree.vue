<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DataSection, ObservedProcess } from '../../../shared/api.js';
import StatusBadge from './StatusBadge.vue';
import SourceNotice from './SourceNotice.vue';
const props = defineProps<{ section: DataSection<ObservedProcess> }>();
const collapsed = ref(new Set<number>());
const processCount = computed(() => {
  const active = props.section.items.filter(process => process.identityVerified).length;
  const recorded = props.section.items.length - active;
  if (!active) return `${recorded} RECORDED`;
  return recorded ? `${active} ACTIVE · ${recorded} RECORDED` : `${active} ACTIVE`;
});
const rows = computed(() => {
  const items = props.section.items, result: { process: ObservedProcess; depth: number; children: boolean }[] = [], visited = new Set<number>();
  const add = (process: ObservedProcess, depth: number) => {
    if (visited.has(process.pid) || depth > 8) return;
    visited.add(process.pid);
    const children = items.filter(item => item.parentPid === process.pid && item.identityVerified);
    result.push({ process, depth, children: children.length > 0 });
    if (!collapsed.value.has(process.pid)) children.forEach(child => add(child, depth + 1));
  };
  items.filter(item => item.parentPid === null || !items.some(parent => parent.pid === item.parentPid)).forEach(item => add(item, 0));
  return result;
});
function toggle(pid: number) { const next = new Set(collapsed.value); if (next.has(pid)) next.delete(pid); else next.add(pid); collapsed.value = next; }
</script>
<template><section class="card panel"><div class="panel-heading"><div><h2>Processes</h2><p class="muted">Recorded identities and verified descendants only. Names alone never establish ownership.</p></div><span class="eyebrow">{{ processCount }}</span></div><SourceNotice :source="section.source" /><p v-if="!section.items.length" class="empty-state">No attributable Worker process is available. Start-up is independent of Worker.</p><div v-else class="table-scroll"><table><thead><tr><th>Process</th><th>PID / PPID</th><th>State</th><th>CPU</th><th>RSS</th><th>Elapsed</th><th>Attribution</th></tr></thead><tbody><tr v-for="{ process, depth, children } in rows" :key="process.id"><td :class="`depth-${Math.min(depth, 4)}`"><button v-if="children" class="tree-toggle" :aria-expanded="!collapsed.has(process.pid)" :aria-label="`${collapsed.has(process.pid) ? 'Expand' : 'Collapse'} process ${process.pid}`" @click="toggle(process.pid)">{{ collapsed.has(process.pid) ? '▸' : '▾' }}</button><span v-else class="tree-leaf" aria-hidden="true">·</span><strong>{{ process.name }}</strong><small class="cell-hint">{{ process.taskId ?? (process.identityVerified ? 'Worker service' : 'Not attributed') }}</small></td><td>{{ process.pid }} / {{ process.ppid ?? '—' }}</td><td>{{ process.state }}</td><td>{{ process.cpuPercent == null ? '—' : `${process.cpuPercent.toFixed(1)}%` }}</td><td>{{ process.rssBytes == null ? '—' : `${(process.rssBytes / 1024 ** 2).toFixed(1)} MiB` }}</td><td>{{ process.elapsedSeconds == null ? '—' : `${Math.floor(process.elapsedSeconds / 60)}m` }}</td><td><StatusBadge :status="process.attribution" /><small class="cell-hint">{{ process.detail ?? 'PID, start ticks and boot ID verified' }}</small></td></tr></tbody></table></div><p v-if="section.truncated" class="source-notice warning">Process tree capped by count, scan time, or depth. Unshown processes are not implied to be absent.</p></section></template>
