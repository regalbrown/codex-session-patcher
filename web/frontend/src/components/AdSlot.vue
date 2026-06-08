<template>
  <aside
    class="ad-slot-frame"
    :class="{ 'ad-slot-frame-empty': !slot }"
    :style="frameStyle"
    aria-label="广告位"
  >
    <a
      v-if="slot && slot.clickUrl"
      class="ad-slot-card"
      :class="fitClass"
      :href="slot.clickUrl"
      :target="linkTarget"
      :rel="linkRel"
      :aria-label="slot.title || slot.alt || '广告位'"
      :title="slot.title || slot.alt || '广告位'"
    >
      <img :src="slot.imageUrl" :alt="slot.alt || '广告图片'" loading="lazy" />
    </a>
    <div
      v-else-if="slot"
      class="ad-slot-card ad-slot-card-static"
      :class="fitClass"
      :title="slot.title || slot.alt || '广告位'"
    >
      <img :src="slot.imageUrl" :alt="slot.alt || '广告图片'" loading="lazy" />
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  slot: {
    type: Object,
    default: null
  }
})

const fitClass = computed(() => {
  return props.slot ? `ad-slot-fit-${props.slot.fit}` : ''
})

const frameStyle = computed(() => {
  if (!props.slot) {
    return {}
  }

  return {
    '--ad-slot-max-height': props.slot.maxHeight,
    '--ad-slot-bg': props.slot.background
  }
})

const isHttpLink = computed(() => /^https?:\/\//i.test(props.slot?.clickUrl || ''))
const linkTarget = computed(() => (isHttpLink.value ? '_blank' : undefined))
const linkRel = computed(() => (isHttpLink.value ? 'noopener noreferrer' : undefined))
</script>

<style scoped>
.ad-slot-frame {
  min-width: 0;
  width: 100%;
}

.ad-slot-frame-empty {
  visibility: hidden;
}

.ad-slot-card {
  position: sticky;
  top: 16px;
  display: block;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--ad-slot-bg, var(--color-bg-1));
  box-shadow: var(--shadow-1);
  overflow: hidden;
  text-decoration: none;
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.ad-slot-card:not(.ad-slot-card-static) {
  cursor: pointer;
}

.ad-slot-card:not(.ad-slot-card-static):hover,
.ad-slot-card:not(.ad-slot-card-static):focus-visible {
  transform: translateY(-2px);
  border-color: var(--color-primary-hover);
  box-shadow: var(--shadow-2);
  outline: none;
}

.ad-slot-card:not(.ad-slot-card-static):active {
  transform: translateY(0);
}

.ad-slot-card img {
  display: block;
  width: 100%;
}

.ad-slot-fit-natural img {
  height: auto;
  max-height: var(--ad-slot-max-height, 72vh);
  object-fit: contain;
}

.ad-slot-fit-contain img,
.ad-slot-fit-cover img,
.ad-slot-fit-fill img {
  height: var(--ad-slot-max-height, 72vh);
  max-height: 72vh;
}

.ad-slot-fit-contain img {
  object-fit: contain;
}

.ad-slot-fit-cover img {
  object-fit: cover;
}

.ad-slot-fit-fill img {
  object-fit: fill;
}
</style>
