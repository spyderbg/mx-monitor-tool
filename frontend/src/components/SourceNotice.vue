<script setup lang="ts">
import type { SourceStatus } from '../../../shared/api.js';
defineProps<{ source: SourceStatus }>();
</script>
<template><p v-if="source.detail" class="source-notice" :class="{ warning: source.status !== 'ok' }" role="status">{{ source.detail }}</p><p class="source-meta">Source: {{ source.status }} · Source time: {{ source.observedAt ?? 'not available' }} · Last read: {{ source.lastSuccessfulAt ?? 'not available' }}<span v-if="source.ageSeconds != null"> · Age {{ Math.floor(source.ageSeconds) }}s</span></p></template>
