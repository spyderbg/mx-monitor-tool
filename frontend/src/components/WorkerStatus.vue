<script setup lang="ts">
import type { WorkerSummary } from '../../../shared/api.js';
import StatusBadge from './StatusBadge.vue';
import SourceNotice from './SourceNotice.vue';
defineProps<{ worker: WorkerSummary }>();
</script>
<template>
  <article class="card worker">
    <div class="card-label">WORKER <StatusBadge :status="worker.status" /></div>
    <div class="worker-body"><div class="worker-symbol" aria-hidden="true">◎</div><div><h2>{{ worker.current ? worker.current.taskId : worker.status === 'not_configured' ? 'Not configured' : worker.status === 'OFFLINE' ? 'Worker offline' : 'Worker observation' }}</h2><p class="muted">{{ worker.reason ? `Recorded reason: ${worker.reason}` : worker.source.detail ?? 'Observing read-only Worker state.' }}</p></div></div>
    <dl class="worker-grid"><div><dt>Directory</dt><dd>{{ worker.directory ?? 'Unknown' }}</dd></div><div><dt>Live process identity</dt><dd>{{ worker.identityVerified ? 'Verified' : 'Not verified' }}</dd></div><div><dt>Persisted last state</dt><dd>{{ worker.persistedState ?? 'Unknown' }}<small v-if="worker.status === 'OFFLINE'"> · historical</small></dd></div><div><dt>Heartbeat (UTC)</dt><dd>{{ worker.heartbeatAt ?? 'Unknown' }}</dd></div><div><dt>Session duration</dt><dd>{{ worker.durationSeconds == null ? 'Unknown' : `${Math.floor(worker.durationSeconds / 60)}m ${Math.floor(worker.durationSeconds % 60)}s` }}</dd></div><div><dt>Format</dt><dd>{{ worker.format ?? 'Not identified' }}</dd></div></dl>
    <div v-if="worker.current" class="run-details"><span class="eyebrow">VERIFIED CURRENT RUN</span><dl><div><dt>Feature / task</dt><dd>{{ worker.current.featureId }} / {{ worker.current.taskId }}</dd></div><div><dt>Step / provider</dt><dd>{{ worker.current.step ?? 'Unknown' }} / {{ worker.current.provider ?? 'Unknown' }}</dd></div><div><dt>Requested model</dt><dd>{{ worker.current.requestedModel ?? 'Unknown' }}<small> · actual model not independently reported</small></dd></div></dl></div>
    <div class="counters" aria-label="Task counts"><div><strong>{{ worker.counts?.active ?? '—' }}</strong><span>Active, identity verified</span></div><div><strong>{{ worker.counts?.waiting ?? '—' }}</strong><span>Waiting / blocked</span></div><div><strong>{{ worker.counts?.attention ?? '—' }}</strong><span>Attention</span></div><div><strong>{{ worker.counts?.verified ?? '—' }}</strong><span>Verified, persisted</span></div></div>
    <p v-if="worker.lastCheckpoint" class="footnote">Last recorded checkpoint: {{ worker.lastCheckpoint.taskId }} / {{ worker.lastCheckpoint.step }} · {{ worker.lastCheckpoint.commit ?? 'no commit' }} · {{ worker.lastCheckpoint.at ?? 'time unknown' }}</p><SourceNotice :source="worker.source" />
  </article>
</template>
