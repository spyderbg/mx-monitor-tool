<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DataSection, MonitorEvent } from '../../../shared/api.js';
import StatusBadge from './StatusBadge.vue';
import SourceNotice from './SourceNotice.vue';
const props = defineProps<{ section: DataSection<MonitorEvent> }>();
const severity = ref(''), type = ref('');
const types = computed(() => [...new Set(props.section.items.map(event => event.type))].sort());
const filtered = computed(() => props.section.items.filter(event => (!severity.value || event.severity === severity.value) && (!type.value || event.type === type.value)));
</script>
<template><section class="card panel"><div class="panel-heading"><div><h2>Recent events</h2><p class="muted">Newest first · allowlisted summaries · no raw event payloads</p></div><div class="filters"><label>Severity<select v-model="severity"><option value="">All severities</option><option>info</option><option>warning</option><option>error</option></select></label><label>Event type<select v-model="type"><option value="">All types</option><option v-for="value in types" :key="value">{{ value }}</option></select></label></div></div><SourceNotice :source="section.source" /><p v-if="!filtered.length" class="empty-state">{{ section.items.length ? 'No events match these filters.' : 'Events unavailable or no supported events have been recorded.' }}</p><ol v-else class="timeline event-timeline"><li v-for="event in filtered" :key="event.id"><div><strong>{{ event.summary }}</strong><StatusBadge :status="event.severity" /></div><p>{{ event.type }}<span v-if="event.taskId"> · {{ event.taskId }}</span><span v-if="event.featureId"> · {{ event.featureId }}</span></p><time>{{ event.at }}</time></li></ol><p v-if="section.truncated" class="source-notice">Showing bounded recent history. Earlier events may be omitted.</p></section></template>
