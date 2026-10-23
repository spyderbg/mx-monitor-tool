<script setup lang="ts">
import { computed } from 'vue';
import type { MonitorSnapshot } from '../../../shared/api.js';
import WorkerStatus from './WorkerStatus.vue';
import SourceNotice from './SourceNotice.vue';
const props = defineProps<{ snapshot: MonitorSnapshot }>();
const machine = computed(() => props.snapshot.machine);
const gib = (bytes: number | undefined) => bytes === undefined ? '—' : (bytes / 1024 ** 3).toFixed(1);
const memoryPercent = computed(() => machine.value.memory ? machine.value.memory.usedBytes / machine.value.memory.totalBytes * 100 : null);
</script>
<template>
  <section class="metrics" aria-label="Machine metrics">
    <article class="card"><div class="card-label">CPU UTILIZATION <span>01</span></div><p class="metric">{{ machine.cpuPercent == null ? '—' : machine.cpuPercent.toFixed(1) }}<small>%</small></p><progress :value="machine.cpuPercent ?? 0" max="100" aria-label="CPU utilization"></progress><p class="muted">{{ machine.cpuPercent == null ? 'Waiting for two valid CPU samples' : `${machine.logicalCpus} logical CPUs available to Monitor` }}</p></article>
    <article class="card"><div class="card-label">MEMORY <span>02</span></div><p class="metric">{{ gib(machine.memory?.usedBytes) }}<small>GiB used</small></p><progress :value="memoryPercent ?? 0" max="100" aria-label="Memory utilization"></progress><p class="muted">{{ gib(machine.memory?.availableBytes) }} GiB available / {{ gib(machine.memory?.totalBytes) }} GiB total</p></article>
    <article class="card"><div class="card-label">LOAD AVERAGE <span>03</span></div><p class="metric">{{ machine.loadAverage?.[0].toFixed(2) ?? '—' }}<small>1 min</small></p><div class="load-values"><span>5 min <b>{{ machine.loadAverage?.[1].toFixed(2) ?? '—' }}</b></span><span>15 min <b>{{ machine.loadAverage?.[2].toFixed(2) ?? '—' }}</b></span></div><p class="muted">Runnable + uninterruptible tasks, not CPU %</p></article>
  </section>
  <SourceNotice :source="machine.source" />
  <section class="details"><WorkerStatus :worker="snapshot.worker" /><article class="card"><div class="card-label">SYSTEM NOTES <span>READ ONLY</span></div><dl><div><dt>Swap used / total</dt><dd>{{ gib(machine.swap?.usedBytes) }} / {{ gib(machine.swap?.totalBytes) }} GiB</dd></div><div><dt>Data timestamp (UTC)</dt><dd>{{ snapshot.observedAt }}</dd></div><div><dt>Stream subscribers</dt><dd>{{ snapshot.diagnostics.streamSubscribers }} / {{ snapshot.diagnostics.limits.subscribers }}</dd></div><div><dt>Last collection</dt><dd>{{ snapshot.diagnostics.cycleMs.toFixed(1) }} ms</dd></div><div><dt>Process / event caps</dt><dd>{{ snapshot.diagnostics.limits.processes }} / {{ snapshot.diagnostics.limits.events }}</dd></div></dl><p class="footnote">Metrics describe the available Linux namespace. No Worker or process controls are exposed.</p></article></section>
</template>
