<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMonitorStream } from './composables/useMonitorStream.js';
import OverviewDashboard from './components/OverviewDashboard.vue';
import ProcessTree from './components/ProcessTree.vue';
import TaskList from './components/TaskList.vue';
import EventTimeline from './components/EventTimeline.vue';
const { snapshot, connection, connectionError, error, age, refresh } = useMonitorStream();
const tab = ref('overview');
const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'processes', label: 'Processes' }, { id: 'tasks', label: 'Tasks / Checkpoints' }, { id: 'events', label: 'Events' }];
const uptime = computed(() => { const seconds = snapshot.value?.machine.uptimeSeconds; return seconds == null ? '—' : `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`; });
</script>
<template>
  <main>
    <header class="masthead"><div class="brand"><span class="brand-mark" aria-hidden="true">↗</span><span>MARXMAN <b>STUDIO</b></span></div><span class="eyebrow">LOCAL OBSERVABILITY / READ ONLY</span></header>
    <section class="heading"><div><p class="eyebrow">YOUR MACHINE, AT A GLANCE</p><h1>MX Monitor Tool<span>.</span></h1><p class="subtitle">A quiet window into your system and Worker.</p></div><div class="connection" role="status"><span class="dot" :class="{ online: connection === 'connected' }"></span>Monitor {{ connection }}<small>{{ age === null ? 'Waiting for first update' : `Updated ${age}s ago · authenticated SSE` }}</small></div></section>
    <p v-if="connectionError || error" class="notice" role="alert">{{ connectionError || error }}</p><p v-if="age !== null && age > 5" class="notice" role="status">Data is stale. Last successful snapshot was {{ age }} seconds ago.</p>
    <nav aria-label="Dashboard sections"><button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.label }}</button></nav>
    <section class="host-strip"><div><span class="dot" :class="{ online: snapshot?.machine.source.status === 'ok' }"></span><strong>{{ snapshot?.machine.hostname ?? 'Connecting to host…' }}</strong><span class="muted">{{ snapshot?.machine.os ?? 'Linux system' }}</span></div><span>UPTIME <b>{{ uptime }}</b></span></section>
    <div v-if="!snapshot" class="card empty-state" role="status">Connecting to the local Monitor. Machine and Worker data will appear after the first authenticated snapshot.</div>
    <template v-else><OverviewDashboard v-if="tab === 'overview'" :snapshot="snapshot" /><ProcessTree v-else-if="tab === 'processes'" :section="snapshot.processes" /><TaskList v-else-if="tab === 'tasks'" :section="snapshot.tasks" :features="snapshot.features" /><EventTimeline v-else :section="snapshot.events" /></template>
    <footer><span>Independent observation · Worker state is never modified · Port allocation provisional</span><button type="button" @click="refresh">Refresh snapshot ↻</button></footer>
  </main>
</template>
