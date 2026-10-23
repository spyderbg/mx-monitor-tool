<script setup lang="ts">
defineProps<{ status: string }>();
</script>
<template><span class="badge" :class="`status-${status.toLowerCase().replaceAll('_', '-')}`">{{ status.replaceAll('_', ' ') }}</span></template>
