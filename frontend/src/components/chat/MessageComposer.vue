<script setup>
import { ArrowRight, Mic, Paperclip, Smile, Square, Trash2 } from "@lucide/vue";
import { computed, nextTick, ref, onBeforeUnmount } from "vue";
import { t } from "../../i18n.js";
import UiTextarea from "../ui/Textarea.vue";
import UiAvatar from "../ui/Avatar.vue";
import PendingAttachmentPreview from "./PendingAttachmentPreview.vue";

const props = defineProps({
	modelValue: {
		type: String,
		default: "",
	},
	pendingAttachment: {
		type: Object,
		default: null,
	},
	sending: {
		type: Boolean,
		default: false,
	},
	isUploading: {
		type: Boolean,
		default: false,
	},
	uploadProgress: {
		type: Number,
		default: 0,
	},
	disabled: {
		type: Boolean,
		default: false,
	},
	error: {
		type: String,
		default: "",
	},
	mentionCandidates: {
		type: Array,
		default: () => [],
	},
});

const emit = defineEmits([
	"update:modelValue",
	"send",
	"upload",
	"clear-attachment",
	"emoji-picker-toggle",
]);
const fileInput = ref(null);
const textarea = ref(null);
const mentionStart = ref(-1);
const mentionQuery = ref("");
const activeMentionIndex = ref(0);

const showEmojiPicker = ref(false);
const EMOJI_LIST = [
	"😊", "😂", "😍", "🎉", "👍", "❤️", "🔥", "🤣", "😎", "😭",
	"🙏", "😮", "👏", "🤔", "🚀", "💯", "✨", "🥳", "🙌", "💩",
	"🤝", "🙈", "💪", "👀", "😅", "🤮", "🙄", "🤩", "🎂", "🍻", "⚡", "🎈"
];

function toggleEmojiPicker() {
	showEmojiPicker.value = !showEmojiPicker.value;
	if (showEmojiPicker.value) {
		textarea.value?.element?.blur();
		emit("emoji-picker-toggle", true);
	} else {
		emit("emoji-picker-toggle", false);
	}
}

function handleTextareaFocus() {
	if (showEmojiPicker.value) {
		showEmojiPicker.value = false;
		emit("emoji-picker-toggle", false);
	}
}

function insertEmoji(emoji) {
	const input = textarea.value?.element;
	if (!input) {
		emit("update:modelValue", props.modelValue + emoji);
		return;
	}
	const cursor = input.selectionStart ?? props.modelValue.length;
	const nextValue =
		props.modelValue.slice(0, cursor) +
		emoji +
		props.modelValue.slice(cursor);
	const nextCursor = cursor + emoji.length;
	emit("update:modelValue", nextValue);
	nextTick(() => {
		if (!showEmojiPicker.value) {
			textarea.value?.focus();
			textarea.value?.element?.setSelectionRange(nextCursor, nextCursor);
		} else if (input && typeof input.setSelectionRange === "function") {
			try {
				input.setSelectionRange(nextCursor, nextCursor);
			} catch (_) {}
		}
	});
}

const isRecording = ref(false);
const recordingDuration = ref(0);
let timer = null;
let mediaRecorder = null;
let audioChunks = [];

const filteredMentions = computed(() => {
	const query = mentionQuery.value.toLocaleLowerCase();
	return props.mentionCandidates
		.filter((member) => {
			if (!query) return true;
			return [member.username, member.displayName].some((value) =>
				String(value || "").toLocaleLowerCase().includes(query),
			);
		})
		.slice(0, 8);
});
const mentionMenuOpen = computed(
	() => mentionStart.value >= 0 && filteredMentions.value.length > 0,
);
const sendDisabled = computed(
	() =>
		props.disabled ||
		props.sending ||
		props.isUploading ||
		(!props.modelValue.trim() && !props.pendingAttachment),
);

function handleKeydown(event) {
	if (mentionMenuOpen.value) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const direction = event.key === "ArrowDown" ? 1 : -1;
			activeMentionIndex.value =
				(activeMentionIndex.value + direction + filteredMentions.value.length) %
				filteredMentions.value.length;
			return;
		}
		if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			selectMention(filteredMentions.value[activeMentionIndex.value]);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			closeMentionMenu();
			return;
		}
	}
	if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
		event.preventDefault();
		if (!sendDisabled.value) {
			emit("send");
		}
	}
}

function syncMentionQuery(event) {
	const input = event.target;
	const cursor = input.selectionStart;
	const match = input.value.slice(0, cursor).match(/(^|[\s([{])@([^\s@]*)$/u);
	if (!match || props.mentionCandidates.length === 0) {
		closeMentionMenu();
		return;
	}
	mentionQuery.value = match[2];
	mentionStart.value = cursor - match[2].length - 1;
	activeMentionIndex.value = 0;
}

function closeMentionMenu() {
	mentionStart.value = -1;
	mentionQuery.value = "";
	activeMentionIndex.value = 0;
}

function selectMention(member) {
	if (!member || mentionStart.value < 0) return;
	const input = textarea.value?.element;
	const cursor = input?.selectionStart ?? props.modelValue.length;
	const replacement = `@${member.username} `;
	const nextValue =
		props.modelValue.slice(0, mentionStart.value) +
		replacement +
		props.modelValue.slice(cursor);
	const nextCursor = mentionStart.value + replacement.length;
	emit("update:modelValue", nextValue);
	closeMentionMenu();
	nextTick(() => {
		textarea.value?.focus();
		textarea.value?.element?.setSelectionRange(nextCursor, nextCursor);
	});
}

function openPicker() {
	fileInput.value?.click();
}

async function startRecording() {
	if (props.disabled || isRecording.value) return;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		mediaRecorder = new MediaRecorder(stream);
		audioChunks = [];
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) audioChunks.push(e.data);
		};
		mediaRecorder.start();
		isRecording.value = true;
		recordingDuration.value = 0;
		timer = setInterval(() => {
			recordingDuration.value += 1;
		}, 1000);
	} catch (err) {
		console.error("无法访问麦克风:", err);
		alert("无法访问麦克风，请检查浏览器权限。");
	}
}

function stopRecording(shouldSend = true) {
	if (!mediaRecorder || !isRecording.value) return;
	if (timer) {
		clearInterval(timer);
		timer = null;
	}

	mediaRecorder.onstop = () => {
		const tracks = mediaRecorder.stream.getTracks();
		tracks.forEach((track) => track.stop());

		if (shouldSend && audioChunks.length > 0) {
			const audioBlob = new Blob(audioChunks, { type: "audio/mp3" });
			const file = new File([audioBlob], "voice-message.mp3", { type: "audio/mp3" });
			const customEvent = { target: { files: [file] } };
			emit("upload", customEvent);
		}
		isRecording.value = false;
		recordingDuration.value = 0;
		audioChunks = [];
		mediaRecorder = null;
	};
	mediaRecorder.stop();
}

function cancelRecording() {
	stopRecording(false);
}

function formatDuration(seconds) {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function dismissInput() {
	if (showEmojiPicker.value) {
		showEmojiPicker.value = false;
		emit("emoji-picker-toggle", false);
	}
	textarea.value?.element?.blur();
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
}

defineExpose({
	dismissInput,
	focus: () => textarea.value?.focus(),
});

onBeforeUnmount(() => {
	if (timer) clearInterval(timer);
	if (mediaRecorder && mediaRecorder.state !== "inactive") {
		const tracks = mediaRecorder.stream.getTracks();
		tracks.forEach((track) => track.stop());
	}
});
</script>

<template>
	<footer class="chat-composer">
		<div v-if="isUploading" class="composer-upload-progress">
			<div class="composer-upload-progress__info">
				<span class="composer-upload-progress__label">
					<svg class="animate-spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
						<circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"></circle>
					</svg>
					{{ t('common.uploading') }}
				</span>
				<span class="composer-upload-progress__value">{{ uploadProgress }}%</span>
			</div>
			<div class="composer-upload-progress__track">
				<div class="composer-upload-progress__bar" :style="{ width: uploadProgress + '%' }"></div>
			</div>
		</div>

		<div v-if="pendingAttachment" class="composer-attachment">
			<PendingAttachmentPreview
				:attachment="pendingAttachment"
				@clear="emit('clear-attachment')"
			/>
		</div>
		<div v-if="error" class="composer-error">{{ error }}</div>
		<div v-if="mentionMenuOpen" class="mention-menu" role="listbox">
			<button
				v-for="(member, index) in filteredMentions"
				:key="member.id"
				type="button"
				class="mention-option"
				:class="{ 'mention-option--active': index === activeMentionIndex }"
				role="option"
				:aria-selected="index === activeMentionIndex"
				@mousedown.prevent
				@click="selectMention(member)"
			>
				<UiAvatar
					:src="member.avatarUrl"
					:fallback="member.displayName || member.username"
					size="xs"
				/>
				<span class="mention-option__label">
					<strong>{{ member.displayName }}</strong>
					<small>@{{ member.username }}</small>
				</span>
			</button>
		</div>

		<div class="composer-row">
			<input
				ref="fileInput"
				type="file"
				class="composer-file-input"
				@change="emit('upload', $event)"
			/>

			<template v-if="isRecording">
				<div class="composer-recording-bar">
					<span class="recording-indicator"></span>
					<span class="recording-time">{{ formatDuration(recordingDuration) }}</span>
				</div>
				<button
					type="button"
					class="composer-btn composer-btn--danger"
					title="取消录音"
					aria-label="取消录音"
					@click="cancelRecording"
				>
					<Trash2 :size="20" aria-hidden="true" />
				</button>
				<button
					type="button"
					class="composer-send"
					title="发送语音"
					aria-label="发送语音"
					@click="stopRecording(true)"
				>
					<ArrowRight :size="22" aria-hidden="true" />
				</button>
			</template>

			<template v-else>
				<button
					type="button"
					class="composer-btn"
					:class="{ 'composer-btn--active': showEmojiPicker }"
					:disabled="disabled || isUploading"
					title="表情包"
					aria-label="表情包"
					@click="toggleEmojiPicker"
				>
					<Smile :size="20" aria-hidden="true" />
				</button>
				<button
					type="button"
					class="composer-btn"
					:disabled="disabled || isUploading"
					:title="t('chat.addAttachment')"
					:aria-label="t('chat.addAttachment')"
					@click="openPicker"
				>
					<Paperclip :size="20" aria-hidden="true" />
				</button>
				<button
					type="button"
					class="composer-btn"
					:disabled="disabled || isUploading"
					title="录制语音消息"
					aria-label="录制语音消息"
					@click="startRecording"
				>
					<Mic :size="20" aria-hidden="true" />
				</button>
				<UiTextarea
					ref="textarea"
					:model-value="modelValue"
					class="composer-input"
					auto-grow
					:max-height="120"
					rows="1"
					:disabled="disabled"
					:placeholder="t('chat.messagePlaceholder')"
					@focus="handleTextareaFocus"
					@update:model-value="emit('update:modelValue', $event)"
					@input="syncMentionQuery"
					@keydown="handleKeydown"
				/>
				<button
					type="button"
					class="composer-send"
					:disabled="sendDisabled"
					:title="t('chat.sendMessage')"
					:aria-label="t('chat.sendMessage')"
					@click="emit('send')"
				>
					<ArrowRight :size="22" aria-hidden="true" />
				</button>
			</template>
		</div>

		<div v-if="showEmojiPicker" class="emoji-picker-menu" role="dialog" aria-label="Emoji 选择器">
			<div class="emoji-picker-grid">
				<button
					v-for="emoji in EMOJI_LIST"
					:key="emoji"
					type="button"
					class="emoji-item"
					@mousedown.prevent
					@click="insertEmoji(emoji)"
				>
					{{ emoji }}
				</button>
			</div>
		</div>
	</footer>
</template>

<style scoped>
.chat-composer {
	position: relative;
	z-index: 2;
	width: 100%;
	box-sizing: border-box;
	margin: auto 0 0;
	padding: 10px 16px;
	border-top: 1px solid #e9edef;
	border-radius: 0;
	background: #f0f2f5;
}

.composer-attachment {
	min-width: 0;
	margin-bottom: 10px;
}

.composer-error {
	margin-bottom: 8px;
	color: #dc2626;
	font-size: 12px;
	text-align: center;
}

.mention-menu {
	position: absolute;
	right: 68px;
	bottom: calc(100% - 2px);
	left: 68px;
	z-index: 4;
	max-height: 280px;
	padding: 6px;
	overflow-y: auto;
	border: 1px solid #dfe5e2;
	border-radius: 8px;
	background: #ffffff;
	box-shadow: 0 10px 28px rgba(17, 27, 33, 0.14);
}

.mention-option {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-height: 44px;
	padding: 6px 10px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	cursor: pointer;
	text-align: left;
}

.mention-option:hover,
.mention-option--active {
	background: #edf8f2;
}

.mention-option__label {
	display: grid;
	min-width: 0;
}

.mention-option__label strong,
.mention-option__label small {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mention-option__label strong {
	color: #111b21;
	font-size: 14px;
	font-weight: 600;
}

.mention-option__label small {
	color: #667781;
	font-size: 12px;
}

.composer-row {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
}

.composer-file-input {
	display: none;
}

.composer-btn,
.composer-send {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border: none;
	border-radius: 50%;
	background: transparent;
	cursor: pointer;
	touch-action: manipulation;
}

.composer-btn {
	color: #54656f;
	transition: background 150ms, color 150ms;
}

.composer-btn:hover:not(:disabled) {
	background: rgba(0, 0, 0, 0.05);
	color: #111b21;
}

.composer-send {
	color: #3b82f6;
	transition: background 150ms;
}

.composer-send:hover:not(:disabled) {
	background: rgba(0, 0, 0, 0.05);
}

.composer-btn:active:not(:disabled),
.composer-send:active:not(:disabled) {
	background: rgba(0, 0, 0, 0.08);
}

.composer-btn:disabled {
	cursor: not-allowed;
	opacity: 0.4;
}

.composer-send:disabled {
	cursor: not-allowed;
	opacity: 0.3;
}

.composer-input {
	flex: 1;
	min-width: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea) {
	width: 100%;
	min-width: 0;
	min-height: 40px;
	padding: 10px 16px;
	border: none;
	border-radius: 8px;
	background: #ffffff;
	box-shadow: none;
	color: #111b21;
	font-size: 15px;
	resize: none;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea:focus) {
	border-color: transparent;
	box-shadow: none;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea::placeholder) {
	color: #8696a0;
}

.composer-btn--danger {
	color: #ef4444;
}

.composer-btn--danger:hover:not(:disabled) {
	background: rgba(239, 68, 68, 0.1);
	color: #dc2626;
}

.composer-recording-bar {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 10px;
	height: 40px;
	padding: 0 14px;
	border-radius: 8px;
	background: #ffffff;
}

.recording-indicator {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #ef4444;
	animation: blink 1s infinite;
}

.recording-time {
	color: #111b21;
	font-size: 14px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

@keyframes blink {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}

.composer-upload-progress {
	margin-bottom: 10px;
	padding: 10px 14px;
	border-radius: 12px;
	background: #ffffff;
	border: 1px solid #e9edef;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.composer-upload-progress__info {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
	font-size: 13px;
}

.composer-upload-progress__label {
	display: flex;
	align-items: center;
	gap: 6px;
	color: #008069;
	font-weight: 600;
}

.composer-upload-progress__value {
	color: #008069;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.composer-upload-progress__track {
	width: 100%;
	height: 6px;
	border-radius: 999px;
	background: #e9edef;
	overflow: hidden;
}

.composer-upload-progress__bar {
	height: 100%;
	border-radius: 999px;
	background: linear-gradient(90deg, #008069, #10b981);
	transition: width 200ms ease;
}

.animate-spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}

.emoji-picker-menu {
	position: absolute;
	left: 16px;
	bottom: calc(100% - 2px);
	z-index: 5;
	width: 290px;
	padding: 10px;
	border: 1px solid #dfe5e2;
	border-radius: 12px;
	background: #ffffff;
	box-shadow: 0 10px 28px rgba(17, 27, 33, 0.14);
}

.emoji-picker-grid {
	display: grid;
	grid-template-columns: repeat(8, minmax(0, 1fr));
	gap: 4px;
}

.emoji-item {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: transparent;
	font-size: 18px;
	cursor: pointer;
	transition: background 150ms, transform 150ms;
}

.emoji-item:hover {
	background: #edf8f2;
	transform: scale(1.2);
}

.composer-btn--active {
	color: #008069;
	background: rgba(0, 128, 105, 0.1);
}

@media (max-width: 960px) {
	.chat-composer {
		padding: 8px max(8px, env(safe-area-inset-right))
			max(8px, env(safe-area-inset-bottom))
			max(8px, env(safe-area-inset-left));
	}

	.mention-menu {
		right: max(56px, env(safe-area-inset-right));
		left: max(56px, env(safe-area-inset-left));
	}

	.emoji-picker-menu {
		position: relative;
		left: auto;
		right: auto;
		bottom: auto;
		top: auto;
		z-index: 1;
		width: 100%;
		max-width: 100%;
		margin-top: 8px;
		padding: 8px 4px 4px;
		border: none;
		border-top: 1px solid #e9edef;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.emoji-picker-grid {
		grid-template-columns: repeat(8, minmax(0, 1fr));
		gap: 6px;
		justify-items: center;
	}

	.emoji-item {
		width: 38px;
		height: 38px;
		font-size: 22px;
	}

	.composer-row {
		gap: 4px;
	}

	.composer-btn,
	.composer-send {
		width: 44px;
		height: 44px;
	}

	/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
	:deep(.composer-input.ui-textarea) {
		min-height: 44px;
		padding: 11px 12px;
		font-size: 16px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.composer-btn,
	.composer-send {
		transition: none;
	}
}
</style>
