<script setup>
import { Volume2, Play, Pause } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import api from '../../api.js';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { t } from '../../i18n.js';
import { isPreviewableImageAttachment } from './attachment-utils.js';

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  }
});

const previewOpen = ref(false);
const previewEl = ref(null);
const imageFailed = ref(false);
const isPlaying = ref(false);
const audioRef = ref(null);
const audioDuration = ref(0);

const isImage = computed(() => isPreviewableImageAttachment(props.attachment));
const isAudio = computed(() => {
  const type = props.attachment?.type || '';
  const name = props.attachment?.name || '';
  return type.startsWith('audio/') || name.toLowerCase().includes('voice-message') || /\.(webm|mp3|ogg|m4a|wav)$/i.test(name);
});
const isVideo = computed(() => {
  if (isAudio.value) return false;
  const type = props.attachment?.type || '';
  const name = props.attachment?.name || '';
  return type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(name);
});

const displayName = computed(() => props.attachment?.name || t('attachments.fallback'));
const openOriginalLabel = computed(() => t('attachments.openOriginalNamed', { name: displayName.value }));
const attachmentUrl = computed(() => api.getFileUrl(props.attachment?.key || props.attachment?.url));

useOverlayLifecycle({
  open: previewOpen,
  onClose: closePreview,
  focusTarget: previewEl
});

function openPreview() {
  if (!isImage.value || imageFailed.value) {
    return;
  }
  previewOpen.value = true;
}

function closePreview() {
  previewOpen.value = false;
}

function toggleVoicePlay() {
  if (!audioRef.value) return;
  if (isPlaying.value) {
    audioRef.value.pause();
  } else {
    audioRef.value.play();
  }
}

function handleLoadedMetadata() {
  if (audioRef.value) {
    audioDuration.value = Math.round(audioRef.value.duration || 0);
  }
}

function formatVoiceDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return '语音';
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  return mins > 0 ? `${mins}'${secs}"` : `${secs}"`;
}

watch(
  () => props.attachment?.key || props.attachment?.url,
  () => {
    imageFailed.value = false;
    isPlaying.value = false;
  }
);
</script>

<template>
  <div class="message-attachment" :class="{ 'message-attachment--image': isImage }">
    <template v-if="isImage">
      <button
        v-if="!imageFailed"
        type="button"
        class="message-attachment__image-button"
        :aria-label="t('attachments.previewNamed', { name: displayName })"
        @click="openPreview"
      >
        <img
          class="message-attachment__image"
          :src="attachmentUrl"
          :alt="displayName"
          loading="lazy"
          @error="imageFailed = true"
        />
      </button>
      <a
        v-else
        :href="attachmentUrl"
        target="_blank"
        rel="noreferrer"
        class="chat-bubble__attachment message-attachment__file"
      >
        {{ displayName }}
      </a>

      <Teleport to="body">
        <div
          v-if="previewOpen"
          ref="previewEl"
          class="image-preview-overlay"
          role="dialog"
          aria-modal="true"
          :aria-label="t('attachments.imagePreviewNamed', { name: displayName })"
          tabindex="-1"
          @click.self="closePreview"
        >
          <div class="image-preview-overlay__toolbar">
            <span class="image-preview-overlay__title">{{ displayName }}</span>
            <a
              class="image-preview-overlay__action"
              :href="attachmentUrl"
              target="_blank"
              rel="noreferrer"
              :aria-label="openOriginalLabel"
            >
              {{ t('attachments.openOriginal') }}
            </a>
            <button type="button" class="image-preview-overlay__close" :aria-label="t('attachments.closePreview')" @click="closePreview">
              {{ t('common.close') }}
            </button>
          </div>
          <img class="image-preview-overlay__image" :src="attachmentUrl" :alt="displayName" />
        </div>
      </Teleport>
    </template>

    <template v-else-if="isVideo">
      <div class="message-attachment__video-wrapper">
        <video
          controls
          playsinline
          preload="metadata"
          class="message-attachment__video"
          :src="`${attachmentUrl}#t=0.1`"
        ></video>
      </div>
    </template>

    <template v-else-if="isAudio">
      <div class="voice-bubble" :class="{ 'voice-bubble--playing': isPlaying }" @click="toggleVoicePlay">
        <audio
          ref="audioRef"
          :src="attachmentUrl"
          preload="metadata"
          @loadedmetadata="handleLoadedMetadata"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @ended="isPlaying = false"
        ></audio>
        <button type="button" class="voice-bubble__btn" aria-label="播放语音">
          <Pause v-if="isPlaying" :size="18" />
          <Play v-else :size="18" style="margin-left: 2px;" />
        </button>
        <div class="voice-bubble__waves">
          <Volume2 :size="18" class="voice-icon" />
          <span class="voice-wave-bar bar1"></span>
          <span class="voice-wave-bar bar2"></span>
          <span class="voice-wave-bar bar3"></span>
        </div>
        <span class="voice-bubble__duration">{{ formatVoiceDuration(audioDuration) }}</span>
      </div>
    </template>

    <a
      v-else
      :href="attachmentUrl"
      target="_blank"
      rel="noreferrer"
      class="chat-bubble__attachment message-attachment__file"
    >
      {{ displayName }}
    </a>
  </div>
</template>

<style scoped>
.message-attachment__video-wrapper {
  margin-top: 6px;
  max-width: 320px;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}

.message-attachment__video {
  display: block;
  width: 100%;
  max-height: 240px;
  border-radius: 12px;
}

.voice-bubble {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 140px;
  max-width: 220px;
  padding: 8px 14px;
  border-radius: 18px;
  background: rgba(0, 128, 105, 0.12);
  color: #008069;
  cursor: pointer;
  user-select: none;
  transition: background 150ms;
}

.voice-bubble:hover {
  background: rgba(0, 128, 105, 0.2);
}

.voice-bubble__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: #008069;
  color: #fff;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.voice-bubble__waves {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
}

.voice-icon {
  flex-shrink: 0;
}

.voice-wave-bar {
  display: inline-block;
  width: 3px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.6;
}

.bar1 { height: 8px; }
.bar2 { height: 14px; }
.bar3 { height: 10px; }

.voice-bubble--playing .voice-wave-bar {
  animation: wave 0.8s infinite ease-in-out alternate;
}

.voice-bubble--playing .bar1 { animation-delay: 0.1s; }
.voice-bubble--playing .bar2 { animation-delay: 0.3s; }
.voice-bubble--playing .bar3 { animation-delay: 0.2s; }

@keyframes wave {
  0% { transform: scaleY(0.4); }
  100% { transform: scaleY(1.3); }
}

.voice-bubble__duration {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
