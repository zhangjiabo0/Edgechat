<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  },
  fallback: {
    type: String,
    default: '?'
  },
  size: {
    type: String,
    default: 'default'
  }
});

const initials = computed(() => String(props.fallback || '?').slice(0, 2).toUpperCase());
const failedSrc = ref('');
const showImage = computed(() => Boolean(props.src) && failedSrc.value !== props.src);

function handleImageError() {
  failedSrc.value = props.src;
}
</script>

<template>
  <div class="ui-avatar" :class="[`ui-avatar--${size}`, { 'ui-avatar--clickable': Boolean($attrs.onClick) }]">
    <img v-if="showImage" :src="src" :alt="alt" @error="handleImageError" />
    <span v-else>{{ initials }}</span>
  </div>
</template>

<style scoped>
.ui-avatar--clickable {
  cursor: pointer;
  transition: transform 150ms ease, opacity 150ms ease;
}

.ui-avatar--clickable:hover {
  transform: scale(1.06);
  opacity: 0.92;
}
</style>
