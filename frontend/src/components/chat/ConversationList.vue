<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { AtSign, BellOff, Search, Trash2, X } from "@lucide/vue";
import { t } from "../../i18n.js";
import UiAvatar from "../ui/Avatar.vue";

const props = defineProps({
	items: {
		type: Array,
		default: () => [],
	},
	activeKey: {
		type: String,
		default: "",
	},
	loading: {
		type: Boolean,
		default: false,
	},
	isRoomMuted: {
		type: Function,
		default: () => false,
	},
});

const emit = defineEmits(["select", "delete-dm"]);

const searchQuery = ref("");

const filteredItems = computed(() => {
	const q = searchQuery.value.trim().toLowerCase();
	if (!q) return props.items;
	return props.items.filter((item) => {
		const title = (item.title || "").toLowerCase();
		const subtitle = (item.subtitle || "").toLowerCase();
		return title.includes(q) || subtitle.includes(q);
	});
});

const contextMenu = ref({
	open: false,
	x: 0,
	y: 0,
	item: null,
});

const menuEl = ref(null);
let longPressTimer = null;
let longPressOrigin = null;
let hasLongPressed = false;
const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

function closeContextMenu() {
	contextMenu.value = { open: false, x: 0, y: 0, item: null };
}

function cancelLongPress() {
	if (longPressTimer !== null) {
		globalThis.clearTimeout(longPressTimer);
		longPressTimer = null;
	}
	longPressOrigin = null;
}

function openContextMenu(event, item) {
	if (item.kind !== "dm") return;
	event.preventDefault();
	event.stopPropagation();
	cancelLongPress();
	contextMenu.value = {
		open: true,
		x: event.clientX,
		y: event.clientY,
		item,
	};
}

function handlePointerDown(event, item) {
	if (item.kind !== "dm") return;
	cancelLongPress();
	hasLongPressed = false;
	if (event.pointerType === "mouse") {
		return;
	}
	const origin = {
		pointerId: event.pointerId,
		x: event.clientX,
		y: event.clientY,
	};
	longPressOrigin = origin;
	longPressTimer = globalThis.setTimeout(() => {
		hasLongPressed = true;
		contextMenu.value = {
			open: true,
			x: origin.x,
			y: origin.y,
			item,
		};
		longPressTimer = null;
	}, LONG_PRESS_DELAY_MS);
}

function handlePointerMove(event) {
	if (!longPressOrigin || event.pointerId !== longPressOrigin.pointerId) {
		return;
	}
	const deltaX = Math.abs(event.clientX - longPressOrigin.x);
	const deltaY = Math.abs(event.clientY - longPressOrigin.y);
	if (deltaX > LONG_PRESS_MOVE_TOLERANCE_PX || deltaY > LONG_PRESS_MOVE_TOLERANCE_PX) {
		cancelLongPress();
	}
}

function handlePointerUp(event) {
	if (longPressOrigin && event.pointerId === longPressOrigin.pointerId) {
		cancelLongPress();
	}
}

function handleItemClick(item) {
	if (hasLongPressed) {
		hasLongPressed = false;
		return;
	}
	closeContextMenu();
	emit("select", item);
}

function handleDeleteDm() {
	const item = contextMenu.value.item;
	closeContextMenu();
	if (item && item.kind === "dm") {
		emit("delete-dm", item.source);
	}
}

function handleWindowPointerDown(event) {
	if (contextMenu.value.open && !menuEl.value?.contains(event.target)) {
		closeContextMenu();
	}
}

function handleWindowKeydown(event) {
	if (contextMenu.value.open && event.key === "Escape") {
		closeContextMenu();
	}
}

onMounted(() => {
	if (typeof window !== "undefined") {
		window.addEventListener("pointerdown", handleWindowPointerDown);
		window.addEventListener("keydown", handleWindowKeydown);
		window.addEventListener("resize", closeContextMenu);
		window.addEventListener("scroll", closeContextMenu, true);
	}
});

onBeforeUnmount(() => {
	cancelLongPress();
	if (typeof window !== "undefined") {
		window.removeEventListener("pointerdown", handleWindowPointerDown);
		window.removeEventListener("keydown", handleWindowKeydown);
		window.removeEventListener("resize", closeContextMenu);
		window.removeEventListener("scroll", closeContextMenu, true);
	}
});
</script>

<template>
	<div class="sidebar-section sidebar-list-container">
		<div class="sidebar-search-box">
			<div class="sidebar-search-input-wrapper">
				<Search :size="15" class="search-icon" aria-hidden="true" />
				<input
					v-model="searchQuery"
					type="search"
					class="sidebar-search-input"
					:placeholder="t('chat.searchConversations')"
					:aria-label="t('chat.searchConversations')"
				/>
				<button
					v-if="searchQuery"
					type="button"
					class="search-clear-btn"
					:title="t('chat.clearSearch')"
					:aria-label="t('chat.clearSearch')"
					@click="searchQuery = ''"
				>
					<X :size="14" aria-hidden="true" />
				</button>
			</div>
		</div>

		<div class="sidebar-list">
			<div v-if="loading && !items.length" class="sidebar-hint">
				{{ t("chat.loadingConversations") }}
			</div>
			<template v-else>
				<div v-if="!items.length" class="sidebar-hint">
					{{ t("chat.noConversations") }}
				</div>
				<div v-else-if="!filteredItems.length" class="sidebar-hint">
					{{ t("chat.noMatchingConversations") }}
				</div>
				<button
					v-for="item in filteredItems"
					:key="item.key"
					type="button"
					class="sidebar-item"
					:class="{ 'sidebar-item--active': activeKey === item.key }"
					@click="handleItemClick(item)"
					@contextmenu="openContextMenu($event, item)"
					@pointerdown="handlePointerDown($event, item)"
					@pointermove="handlePointerMove"
					@pointerup="handlePointerUp"
					@pointercancel="cancelLongPress"
				>
					<UiAvatar
						:src="item.avatarUrl"
						:fallback="item.fallback?.[0] || '?'"
						size="sm"
					/>
					<div class="sidebar-label-group">
						<div class="sidebar-item__top">
							<strong>{{ item.title }}</strong>
							<span class="sidebar-item__time">{{ item.dateLabel }}</span>
						</div>
						<div class="sidebar-item__bottom">
							<p class="sidebar-item__preview">{{ item.subtitle }}</p>
							<span
								v-if="isRoomMuted(item)"
								class="sidebar-muted-indicator"
								:title="t('chat.muted')"
								:aria-label="t('chat.muted')"
							>
								<BellOff :size="14" aria-hidden="true" />
							</span>
							<span v-if="item.mentionUnreadCount > 0" class="sidebar-mention-badge">
								<AtSign :size="13" aria-hidden="true" />
								{{ t("chat.mentionedMe") }}
							</span>
							<span v-if="item.unreadCount > 0" class="sidebar-unread-badge">
								{{ item.unreadCount > 99 ? "99+" : item.unreadCount }}
							</span>
						</div>
					</div>
				</button>
			</template>
		</div>

		<Teleport to="body">
			<Transition name="conversation-menu">
				<div
					v-if="contextMenu.open && contextMenu.item"
					ref="menuEl"
					class="conversation-context-menu"
					:style="{
						left: `${Math.max(8, Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 180))}px`,
						top: `${Math.max(8, Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 1000) - 60))}px`
					}"
					role="menu"
					@contextmenu.prevent
				>
					<button
						type="button"
						role="menuitem"
						class="conversation-context-menu__danger"
						@click="handleDeleteDm"
					>
						<Trash2 :size="16" aria-hidden="true" />
						{{ t('chat.deleteDm') }}
					</button>
				</div>
			</Transition>
		</Teleport>
	</div>
</template>

<style scoped>
.sidebar-list-container {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
	height: 100%;
	overflow: hidden;
}

.sidebar-search-box {
	padding: 8px 12px;
	border-bottom: 1px solid #f0f2f5;
	background: #ffffff;
}

.sidebar-search-input-wrapper {
	position: relative;
	display: flex;
	align-items: center;
}

.search-icon {
	position: absolute;
	left: 10px;
	color: #8696a0;
	pointer-events: none;
}

.sidebar-search-input {
	width: 100%;
	height: 35px;
	padding: 0 32px 0 32px;
	border: 1px solid transparent;
	border-radius: 8px;
	background: #f0f2f5;
	color: #111b21;
	font-size: 14px;
	outline: none;
	transition: all 150ms ease;
}

.sidebar-search-input:focus {
	border-color: #00a884;
	background: #ffffff;
	box-shadow: 0 0 0 2px rgba(0, 168, 132, 0.2);
}

.sidebar-search-input::-webkit-search-cancel-button {
	display: none;
}

.search-clear-btn {
	position: absolute;
	right: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	padding: 0;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: #8696a0;
	cursor: pointer;
	transition: background 150ms;
}

.search-clear-btn:hover {
	background: rgba(0, 0, 0, 0.06);
}

.sidebar-list {
	flex: 1;
	min-height: 0;
	height: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 4px 0;
	touch-action: pan-y;
	-webkit-overflow-scrolling: touch;
	overscroll-behavior-y: none;
}

.sidebar-list::-webkit-scrollbar {
	width: 4px;
}

.sidebar-list::-webkit-scrollbar-thumb {
	border-radius: 2px;
	background: rgba(0, 0, 0, 0.15);
}

.sidebar-hint {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px 8px;
	color: #8696a0;
	font-size: 13px;
}

.sidebar-item {
	display: flex;
	align-items: center;
	gap: 12px;
	width: calc(100% - 16px);
	margin: 4px 8px;
	padding: 12px 16px;
	border: none;
	border-radius: 12px;
	background: transparent;
	cursor: pointer;
	text-align: left;
	transition: background 150ms;
	user-select: none;
	-webkit-user-select: none;
}

.sidebar-item:hover {
	background: #f5f6f6;
}

.sidebar-item:active {
	background: rgba(0, 0, 0, 0.08);
}

.sidebar-item--active {
	background: #f0f2f5;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.sidebar-item :deep(.ui-avatar) {
	flex-shrink: 0;
}

.sidebar-label-group {
	flex: 1;
	min-width: 0;
}

.sidebar-item__top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.sidebar-item__top strong {
	overflow: hidden;
	color: #111b21;
	font-size: 15px;
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sidebar-item__time {
	flex-shrink: 0;
	color: #667781;
	font-size: 12px;
}

.sidebar-item__bottom {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	margin-top: 4px;
}

.sidebar-item__preview {
	flex: 1;
	min-width: 0;
	margin: 0;
	overflow: hidden;
	color: #667781;
	font-size: 13px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sidebar-muted-indicator {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	color: #8696a0;
}

.sidebar-unread-badge {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	border-radius: 999px;
	background: #25d366;
	color: #ffffff;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	line-height: 1;
}

.sidebar-mention-badge {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 2px;
	color: #d93025;
	font-size: 11px;
	font-weight: 700;
	white-space: nowrap;
}

.conversation-context-menu {
	position: fixed;
	z-index: 1000;
	width: 168px;
	padding: 6px;
	border: 1px solid rgba(11, 20, 26, 0.08);
	border-radius: 8px;
	background: #ffffff;
	box-shadow: 0 2px 5px rgba(11, 20, 26, 0.16), 0 6px 18px rgba(11, 20, 26, 0.12);
}

.conversation-context-menu button {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-height: 36px;
	padding: 0 10px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #111b21;
	font: inherit;
	font-size: 13.5px;
	text-align: left;
	cursor: pointer;
}

.conversation-context-menu button.conversation-context-menu__danger {
	color: #c62828;
}

.conversation-context-menu button:hover,
.conversation-context-menu button:active {
	background: #f5f6f6;
}

.conversation-menu-enter-active,
.conversation-menu-leave-active {
	transition: opacity 100ms ease, transform 100ms ease;
	transform-origin: top left;
}

.conversation-menu-enter-from,
.conversation-menu-leave-to {
	opacity: 0;
	transform: scale(0.96);
}

@media (max-width: 960px) {
	.sidebar-list {
		padding-bottom: max(8px, env(safe-area-inset-bottom));
		overscroll-behavior: contain;
	}

	.sidebar-item {
		width: 100%;
		min-height: 68px;
		margin: 0;
		padding: 11px max(16px, env(safe-area-inset-right)) 11px
			max(16px, env(safe-area-inset-left));
		border-radius: 0;
	}

	.sidebar-item + .sidebar-item {
		border-top: 1px solid #f0f2f5;
	}

	.sidebar-search-input {
		font-size: 16px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.sidebar-item {
		transition: none;
	}
}
</style>
