<script setup>
import { ArrowLeft, Bell, BellOff, ChevronDown, Menu, MessageSquare, Search, Settings, UsersRound, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { isDemoMode } from '../runtime.js';
import api from '../api.js';
import AddConversationDialog from '../components/chat/AddConversationDialog.vue';
import ConversationList from '../components/chat/ConversationList.vue';
import CreateGroupDialog from '../components/chat/CreateGroupDialog.vue';
import GroupSettingsDialog from '../components/chat/GroupSettingsDialog.vue';
import MemberPanel from '../components/chat/MemberPanel.vue';
import MessageAttachment from '../components/chat/MessageAttachment.vue';
import MessageComposer from '../components/chat/MessageComposer.vue';
import MentionText from '../components/chat/MentionText.vue';
import MessageContextMenu from '../components/chat/MessageContextMenu.vue';
import PinnedMessageBar from '../components/chat/PinnedMessageBar.vue';
import MobileNavigationDrawer from '../components/chat/MobileNavigationDrawer.vue';
import SenderSourceBadge from '../components/chat/SenderSourceBadge.vue';
import PublicGroupDiscovery from '../components/chat/PublicGroupDiscovery.vue';
import PublicGroupJoinDialog from '../components/chat/PublicGroupJoinDialog.vue';
import UiAvatar from '../components/ui/Avatar.vue';
import UiButton from '../components/ui/Button.vue';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { useActiveRoom } from '../composables/useActiveRoom.js';
import { useBrowserNotifications } from '../composables/useBrowserNotifications.js';
import { useChatRoom } from '../composables/useChatRoom.js';
import { useChatSidebar } from '../composables/useChatSidebar.js';
import { useChatViewport } from '../composables/useChatViewport.js';
import { useConversationFlow } from '../composables/useConversationFlow.ts';
import { useConversationCreation } from '../composables/useConversationCreation.js';
import { useMessageContextMenu } from '../composables/useMessageContextMenu.ts';
import { useRoomManagement } from '../composables/useRoomManagement.js';
import { useUnreadInbox } from '../composables/useUnreadInbox.js';
import { resolveMentionUserIds } from '../mentions.ts';
import store from '../store.js';
import { useI18n } from '../i18n.js';

const router = useRouter();
const { formatDate: formatLocaleDate, formatTime: formatLocaleTime, parseDate, t } = useI18n();
const error = ref('');
const activeRoom = ref(null);
const showMobileNavigation = ref(false);
const publicGroupPreview = ref(null);
const joiningPublicGroup = ref(false);
const session = computed(() => store.session);
const siteName = computed(() => store.site?.siteName || 'Edgechat');
const showAdminEntry = computed(() => Boolean(session.value?.isAdmin));

const showMessageSearch = ref(false);
const messageSearchQuery = ref('');

const avatarPreviewModal = reactive({
  open: false,
  src: '',
  name: '',
  fallback: '',
  user: null
});

function extractTargetUser(userOrRoom) {
  if (!userOrRoom) return null;

  if (userOrRoom.kind === 'dm' && userOrRoom.otherUser) {
    return userOrRoom.otherUser;
  }

  if (userOrRoom.kind === 'channel' || userOrRoom.kind === 'group' || userOrRoom.kind === 'public' || userOrRoom.kind === 'private' || userOrRoom.kind === 'external') {
    return null;
  }

  const userId = userOrRoom.id || userOrRoom.userId;
  if (userId) {
    return {
      id: userId,
      displayName: userOrRoom.displayName || userOrRoom.name || userOrRoom.username || '',
      username: userOrRoom.username || '',
      avatarUrl: userOrRoom.avatarUrl || ''
    };
  }

  return null;
}

function previewAvatar(userOrRoom) {
  if (!userOrRoom) return;
  const targetUser = extractTargetUser(userOrRoom);
  const rawUrl = userOrRoom.avatarUrl || userOrRoom.src || userOrRoom.otherUser?.avatarUrl || targetUser?.avatarUrl || '';
  const src = rawUrl ? api.getFileUrl(rawUrl) : '';
  const name = userOrRoom.displayName || userOrRoom.title || userOrRoom.name || userOrRoom.otherUser?.displayName || targetUser?.displayName || t('chat.avatarPreview');
  const fallback = (name || '?').slice(0, 2).toUpperCase();

  const currentUserId = session.value?.userId || session.value?.id;
  if (targetUser && targetUser.id && Number(targetUser.id) !== Number(currentUserId)) {
    avatarPreviewModal.user = targetUser;
  } else {
    avatarPreviewModal.user = null;
  }

  avatarPreviewModal.src = src;
  avatarPreviewModal.name = name;
  avatarPreviewModal.fallback = fallback;
  avatarPreviewModal.open = true;
}

function closeAvatarPreviewModal() {
  avatarPreviewModal.open = false;
  avatarPreviewModal.user = null;
}

async function startDirectMessageFromAvatar() {
  const targetUser = avatarPreviewModal.user;
  closeAvatarPreviewModal();
  if (targetUser) {
    await openDm(targetUser);
  }
}

const filteredMessages = computed(() => {
  const q = messageSearchQuery.value.trim().toLowerCase();
  if (!q) return messages.value;
  return messages.value.filter((msg) => {
    const content = (msg.content || '').toLowerCase();
    const sender = (msg.sender?.displayName || '').toLowerCase();
    const attachmentName = (msg.attachment?.name || msg.attachment?.originalName || msg.attachment?.filename || '').toLowerCase();
    return content.includes(q) || sender.includes(q) || attachmentName.includes(q);
  });
});

function toggleMessageSearch() {
  showMessageSearch.value = !showMessageSearch.value;
  if (!showMessageSearch.value) {
    messageSearchQuery.value = '';
  }
}

function closeMessageSearch() {
  showMessageSearch.value = false;
  messageSearchQuery.value = '';
}

const { activeRoomKey, canManageActiveRoom, applyActiveChannel, selectDm, roomLabel, roomSubtitle } =
  useActiveRoom({ activeRoom });
const {
  isMobileViewport,
  mobileView,
  startViewportSync,
  stopViewportSync,
  openConversationView,
  returnToConversationList
} = useChatViewport({ activeRoom });
const activeRoomAvatar = computed(() => {
  if (!activeRoom.value) return '';
  return activeRoom.value.kind === 'dm'
    ? activeRoom.value.otherUser?.avatarUrl || ''
    : activeRoom.value.avatarUrl || '';
});

const {
  channels, dms, users, sidebarLoading, conversationItems, publicGroupItems,
  refreshSidebar, openConversation, joinPublicChannel, markConversationRead, applyConversationActivity
} = useChatSidebar({ applyActiveChannel, selectDm });
const { openConversationItem, openByIdentity, refreshAndOpen } = useConversationFlow({
  conversationItems,
  refreshSidebar,
  openConversation,
  openConversationView
});

const {
  notificationsEnabled,
  notificationStateLabel,
  notificationActionLabel,
  notificationToggleDisabled,
  syncNotificationPermission,
  toggleNotifications,
  isRoomMuted,
  toggleRoomMuted,
  notifyRoom
} = useBrowserNotifications({
  userId: session.value?.userId,
  onOpenRoom: openRoomFromNotification
});
const activeRoomMuted = computed(() => isRoomMuted(activeRoom.value));

function handleRoomActivity({ room, message }) {
  applyConversationActivity({
    kind: room.kind,
    roomId: room.id,
    lastMessageAt: message.createdAt,
    lastMessageContent: message.content,
    lastMessageAttachmentType: message.attachment?.type,
    lastMessageSenderName: message.sender?.displayName || message.senderName,
    unreadCount: 0,
    mentionUnreadCount: 0
  });
  markConversationRead(room.kind, room.id);
}

function handleRoomAccessRevoked(room) {
  const roomName = room.name || t('chat.privateGroup');
  error.value = room.kind === 'private'
    ? t('chat.roomAccessRevokedNamed', { name: roomName })
    : t('chat.roomAccessRevoked');
  activeRoom.value = null;
  returnToConversationList();
  void refreshSidebar();
}

const {
  messages, pinnedMessage, highlightedMessageId, loading, hasMore, wsStatus, composerText, pendingAttachment, isUploadingAttachment, uploadProgress, sending,
  messagesEl, isOwnMessage,
  loadMessages, activateRoom, deactivateRoom, disconnectSocket, sendMessage, deleteMessage,
  pinMessage, unpinMessage, revealPinnedMessage,
  uploadAttachment, clearAttachment, loadOlder
} = useChatRoom({
  activeRoom,
  session,
  error,
  onRoomActivity: handleRoomActivity,
  onRoomAccessRevoked: handleRoomAccessRevoked
});

const { connectUnreadInbox, disconnectUnreadInbox } = useUnreadInbox({
  activeRoom,
  markConversationRead,
  applyConversationActivity,
  notifyRoom
});

const wsConnected = computed(() => wsStatus.value === 'open');
const activeRoomSubtitle = computed(() => roomSubtitle(activeRoom.value, wsConnected.value));
const canModerateMessages = computed(
  () => Boolean(session.value?.isAdmin || canManageActiveRoom.value)
);
const canPinMessages = computed(
  () => Boolean(activeRoom.value?.kind !== 'dm' && (session.value?.isAdmin || canManageActiveRoom.value))
);
const {
  messageMenu,
  closeMessageMenu,
  cancelMessageLongPress,
  openMessageContextMenu,
  startMessageLongPress,
  trackMessageLongPress
} = useMessageContextMenu({ canModerateMessages });
const selectedMessageIsPinned = computed(
  () => Number(messageMenu.value.message?.id) === Number(pinnedMessage.value?.id)
);
const canDeleteSelectedMessage = computed(() => {
  const msg = messageMenu.value.message;
  if (!msg) return false;
  return isOwnMessage(msg) || canModerateMessages.value;
});

const roomManagement = useRoomManagement({
  activeRoom, channels, users, error, refreshSidebar, refreshAndOpen, canManageActiveRoom,
  returnToConversationList,
  onRoomDeleted: () => {
    disconnectSocket();
    messages.value = [];
    pinnedMessage.value = null;
  }
});
const { creation, members: memberManagement, settings: groupSettings, deleteGroup } = roomManagement;
const {
  show: showCreateGroup,
  form: createGroupForm,
  submitting: creatingGroup,
  open: openCreateGroup,
  close: closeCreateGroup,
  toggleMember: toggleCreateGroupMember,
  submit: createGroup
} = creation;
const {
  show: showAddConversation,
  usersWithoutDm,
  openingDmUserId,
  open: openAddConversation,
  close: closeAddConversation,
  startGroupCreation,
  openDm
} = useConversationCreation({
  users,
  dms,
  error,
  refreshAndOpen,
  openGroupDialog: openCreateGroup
});
const {
  show: showMemberPanel,
  items: groupMembers,
  loading: memberLoading,
  inviteUserId,
  availableUsers: availableInviteUsers,
  inviteSubmitting,
  toggle: toggleMemberPanel,
  close: closeMemberPanel,
  invite: inviteMember,
  remove: removeMember
} = memberManagement;
const mentionCandidates = computed(() =>
	activeRoom.value?.kind === 'dm'
		? []
		: groupMembers.value.filter((member) => Number(member.id) !== Number(session.value?.userId))
);

function sendComposerMessage() {
	return sendMessage(
		resolveMentionUserIds(composerText.value, mentionCandidates.value, session.value?.userId)
	);
}
const {
  show: showGroupEditor,
  form: groupSettingsForm,
  saving: groupSettingsSaving,
  avatarUploading: groupAvatarUploading,
  open: openGroupEditor,
  close: closeGroupEditor,
  uploadAvatar: uploadGroupAvatar,
  save: saveGroupSettings
} = groupSettings;

async function selectConversation(item) {
  try {
    await openConversationItem(item);
  } catch (currentError) {
    error.value = currentError.message;
  }
}

function openPublicGroupPreview(item) {
  publicGroupPreview.value = item.source;
}

function closePublicGroupPreview() {
  if (!joiningPublicGroup.value) publicGroupPreview.value = null;
}

async function confirmPublicGroupJoin() {
  const channel = publicGroupPreview.value;
  if (!channel) return;

  joiningPublicGroup.value = true;
  error.value = '';
  try {
    await joinPublicChannel(channel);
    publicGroupPreview.value = null;
    await openByIdentity(channel);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    joiningPublicGroup.value = false;
  }
}

async function openRoomFromNotification(room) {
  try {
    await openByIdentity(room);
  } catch (currentError) {
    error.value = currentError.message;
  }
}

function toggleActiveRoomMute() {
  if (activeRoom.value) toggleRoomMuted(activeRoom.value);
}

function logout() { store.logout(); router.push('/login'); }
function openAdmin() { router.push('/admin'); }
function openSettings() { router.push('/settings'); }
function closeMobileNavigation() { showMobileNavigation.value = false; }
function navigateFromMobileDrawer(callback) {
  closeMobileNavigation();
  callback();
}
function returnToMobileConversationList() {
  closeMemberPanel();
  closeMessageMenu();
  returnToConversationList();
}

async function bootstrap() {
  error.value = '';
  try {
    await refreshSidebar();
    if (isDemoMode && !activeRoom.value && conversationItems.value.length) {
      await selectConversation(conversationItems.value[0]);
    }
  }
  catch (e) { error.value = e.message; }
}

watch(activeRoomKey, async (k) => {
  closeMessageMenu();
  cancelMessageLongPress();
  closeMessageSearch();
  if (!k) {
    deactivateRoom();
    return;
  }
  openConversationView();
  const loaded = await activateRoom();
  if (!loaded || activeRoomKey.value !== k) return;
  for (const delay of [0, 50, 150, 300]) {
    await new Promise(r => setTimeout(r, delay));
    if (activeRoomKey.value !== k) return;
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  }
});

function confirmDeleteMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message || !window.confirm(t('chat.deleteMessageConfirm'))) {
    return;
  }
  deleteMessage(message.id);
}

function pinSelectedMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (message) pinMessage(message.id);
}

async function copySelectedMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message) return;

  const content = message.content || '';
  const attachmentName = message.attachment?.name || '';
  const textToCopy = content && attachmentName ? `${content}\n[${attachmentName}]` : (content || attachmentName);
  if (!textToCopy) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  } catch (err) {
    console.error('Failed to copy message:', err);
  }
}

function unpinSelectedMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (message) unpinMessage(message.id);
}

const textSelectionModal = reactive({
  open: false,
  text: ''
});

function openSelectTextModal() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message) return;

  const content = message.content || '';
  const attachmentName = message.attachment?.name || '';
  const text = content && attachmentName ? `${content}\n[${attachmentName}]` : (content || attachmentName);
  if (!text) return;

  textSelectionModal.text = text;
  textSelectionModal.open = true;
}

function closeSelectTextModal() {
  textSelectionModal.open = false;
  textSelectionModal.text = '';
}

async function copyTextSelectionModalText() {
  const textToCopy = textSelectionModal.text;
  if (!textToCopy) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textToCopy);
    }
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
}


onMounted(() => {
  startViewportSync();
  window.addEventListener('focus', syncNotificationPermission);
  void bootstrap().then(connectUnreadInbox);
});

function isSameDay(leftVal, rightVal) {
  if (!leftVal || !rightVal) return false;
  const d1 = parseDate(leftVal);
  const d2 = parseDate(rightVal);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function shouldShowDateDivider(messagesList, index) {
  if (index === 0) return true;
  const prevMsg = messagesList[index - 1];
  const currMsg = messagesList[index];
  return !isSameDay(prevMsg?.createdAt, currMsg?.createdAt);
}

function formatBubbleTime(value) {
  return value ? formatLocaleTime(value) : '';
}

const showScrollToBottom = ref(false);
const loadingOlder = ref(false);
const recentlyLoadedIds = ref(new Set());

let lastScrollTop = 0;

async function triggerLoadOlder() {
  if (!hasMore.value || loading.value || loadingOlder.value || showMessageSearch.value || !messages.value.length) return;
  const container = messagesEl.value;
  if (!container) return;

  loadingOlder.value = true;
  const oldScrollHeight = container.scrollHeight;
  const oldScrollTop = container.scrollTop;
  const existingIds = new Set(messages.value.map((m) => m.id));

  try {
    const firstMessage = messages.value[0];
    if (firstMessage) {
      const loaded = await loadMessages(firstMessage.id, true);
      if (loaded) {
        await nextTick();
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);

        const newIds = new Set();
        for (const msg of messages.value) {
          if (!existingIds.has(msg.id)) {
            newIds.add(msg.id);
          }
        }
        recentlyLoadedIds.value = newIds;
        setTimeout(() => {
          recentlyLoadedIds.value = new Set();
        }, 600);
      }
    }
  } finally {
    loadingOlder.value = false;
  }
}

function handleScroll() {
  if (!messagesEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = messagesEl.value;
  showScrollToBottom.value = scrollHeight - scrollTop - clientHeight > 120;

  const isScrollingUp = scrollTop < lastScrollTop;
  lastScrollTop = scrollTop;

  if (isScrollingUp && scrollTop <= 50 && hasMore.value) {
    void triggerLoadOlder();
  }
}

function handleWheel(event) {
  if (!messagesEl.value) return;
  if (event.deltaY < 0 && messagesEl.value.scrollTop <= 50 && hasMore.value) {
    void triggerLoadOlder();
  }
}

function scrollToBottomSmooth() {
  if (messagesEl.value) {
    messagesEl.value.scrollTo({
      top: messagesEl.value.scrollHeight,
      behavior: 'smooth'
    });
  }
}

onBeforeUnmount(() => {
  cancelMessageLongPress();
  window.removeEventListener('focus', syncNotificationPermission);
  disconnectUnreadInbox();
  disconnectSocket();
  stopViewportSync();
});
</script>

<template>
  <div
    class="chat-layout"
    :class="{
      'chat-layout--mobile': isMobileViewport,
      'chat-layout--mobile-list': isMobileViewport && mobileView === 'list',
      'chat-layout--mobile-chat': isMobileViewport && mobileView === 'chat'
    }"
  >
    <!-- Far-Left Navigation Sidebar -->
    <aside class="right-sidebar">
      <div class="right-sidebar-inner">
        <div class="right-sidebar-section right-sidebar-actions">
          <button
            type="button"
            class="right-sidebar-action right-sidebar-action--labeled tooltip"
            :class="{ 'right-sidebar-action--notification-active': notificationsEnabled }"
            :data-tooltip="notificationActionLabel"
            :aria-label="notificationActionLabel"
            :aria-pressed="notificationsEnabled"
            :disabled="notificationToggleDisabled"
            @click="toggleNotifications"
          >
            <Bell v-if="notificationsEnabled" :size="20" aria-hidden="true" />
            <BellOff v-else :size="20" aria-hidden="true" />
            <span class="right-sidebar-action__label">{{ notificationStateLabel }}</span>
          </button>
          <button
            v-if="showAdminEntry"
            type="button"
            class="right-sidebar-action right-sidebar-action--admin tooltip"
            :data-tooltip="t('nav.admin')"
            :aria-label="t('nav.admin')"
            @click="openAdmin"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
              <title>{{ t('nav.admin') }}</title>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span class="right-sidebar-action__label">{{ t('nav.admin') }}</span>
          </button>
        </div>

        <div class="right-sidebar-section right-sidebar-user-group">
          <button type="button" class="right-sidebar-user tooltip" :data-tooltip="t('nav.personalSettings')" :aria-label="t('nav.personalSettings')" @click="router.push('/settings')">
            <UiAvatar :src="session?.avatarUrl" :fallback="session?.displayName?.[0] || 'U'" size="sm" />
          </button>
          <button type="button" class="right-sidebar-action right-sidebar-action--danger tooltip" :data-tooltip="t('auth.signOut')" :aria-label="t('auth.signOut')" @click="logout">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
              <title>{{ t('auth.signOut') }}</title>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Middle-Left Chat List Sidebar -->
    <aside class="left-sidebar">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <button
            type="button"
            class="header-action mobile-menu-action"
            :aria-label="t('nav.openNavigation')"
            :aria-expanded="showMobileNavigation"
            @click="showMobileNavigation = true"
          >
            <Menu :size="22" aria-hidden="true" />
          </button>
          <h1 class="brand-title">{{ siteName }}</h1>
          <div class="sidebar-header-actions">
            <button
              type="button"
              class="header-action"
              :title="t('chat.addPeople')"
              :aria-label="t('chat.addPeople')"
              aria-haspopup="dialog"
              :aria-expanded="showAddConversation"
              @click="openAddConversation"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <title>{{ t('chat.addPeople') }}</title>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </button>
            <LanguageSwitch class="mobile-language-switch" />
          </div>
        </div>

        <div class="sidebar-divider"></div>

		<ConversationList
		  :items="conversationItems"
		  :active-key="activeRoomKey"
		  :loading="sidebarLoading"
		  :is-room-muted="isRoomMuted"
		  @select="selectConversation"
		/>

		<PublicGroupDiscovery :items="publicGroupItems" @select="openPublicGroupPreview" />
      </div>
    </aside>

    <!-- Right Main Chat Window -->
    <main class="chat-main">
      <template v-if="activeRoom">
        <header class="chat-header">
          <button
            type="button"
            class="chat-header__back"
            :aria-label="t('chat.backToConversationList')"
            @click="returnToMobileConversationList"
          >
            <ArrowLeft :size="24" aria-hidden="true" />
          </button>
          <UiAvatar
            class="chat-header__avatar"
            :src="activeRoomAvatar"
            :fallback="roomLabel(activeRoom)?.[0] || '?'"
            size="sm"
            @click="previewAvatar(activeRoom)"
          />
          <div class="chat-header__identity">
            <h2>{{ roomLabel(activeRoom) }}</h2>
            <span>{{ activeRoomSubtitle }}</span>
          </div>
          <div class="chat-header__actions">
            <div
              class="chat-header__status"
              :class="wsConnected ? 'online' : 'offline'"
              :title="wsConnected ? t('chat.connected') : t('chat.connecting')"
              :aria-label="wsConnected ? t('chat.connected') : t('chat.connecting')"
              role="status"
            ></div>
            <button
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': activeRoomMuted }"
              :title="activeRoomMuted ? t('chat.unmuteCurrent') : t('chat.muteCurrent')"
              :aria-label="activeRoomMuted ? t('chat.unmuteCurrent') : t('chat.muteCurrent')"
              :aria-pressed="activeRoomMuted"
              @click="toggleActiveRoomMute"
            >
              <BellOff v-if="activeRoomMuted" :size="19" aria-hidden="true" />
              <Bell v-else :size="19" aria-hidden="true" />
              <span>{{ activeRoomMuted ? t('chat.mutedShort') : t('chat.mute') }}</span>
            </button>
            <button
              v-if="activeRoom.kind !== 'dm'"
              type="button"
              class="chat-header__button"
              :aria-label="showMemberPanel ? t('chat.closeMembers') : t('chat.viewMembers')"
              :aria-expanded="showMemberPanel"
              @click="toggleMemberPanel"
            >
              <UsersRound :size="19" aria-hidden="true" />
              <span>{{ showMemberPanel ? t('chat.collapseMembers') : t('chat.members') }}</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': showMessageSearch }"
              :title="t('chat.searchMessages')"
              :aria-label="t('chat.searchMessages')"
              @click="toggleMessageSearch"
            >
              <Search :size="19" aria-hidden="true" />
              <span>{{ t('admin.sidebar.search') }}</span>
            </button>
            <button
              v-if="canManageActiveRoom"
              type="button"
              class="chat-header__button"
              :aria-label="t('chat.openGroupSettings')"
              @click="openGroupEditor"
            >
              <Settings :size="19" aria-hidden="true" />
              <span>{{ t('chat.groupSettings') }}</span>
            </button>
            <LanguageSwitch class="chat-header__language-switch" />
          </div>
        </header>

        <PinnedMessageBar
          v-if="pinnedMessage && activeRoom.kind !== 'dm'"
          :message="pinnedMessage"
          :can-unpin="canPinMessages"
          @reveal="revealPinnedMessage"
          @unpin="unpinMessage(pinnedMessage.id)"
        />

        <div v-if="showMessageSearch" class="chat-search-bar">
          <Search :size="16" class="chat-search-bar__icon" aria-hidden="true" />
          <input
            v-model="messageSearchQuery"
            type="search"
            class="chat-search-bar__input"
            :placeholder="t('chat.searchMessages')"
            :aria-label="t('chat.searchMessages')"
          />
          <span v-if="messageSearchQuery" class="chat-search-bar__count">
            {{ filteredMessages.length }} / {{ messages.length }}
          </span>
          <button
            type="button"
            class="chat-search-bar__close"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="closeMessageSearch"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </div>

        <section ref="messagesEl" class="chat-messages" @scroll="handleScroll" @wheel="handleWheel">
          <button v-if="hasMore && messages.length && !showMessageSearch" type="button" class="load-more-btn" @click="triggerLoadOlder">{{ t('chat.loadEarlier') }}</button>
          <div v-if="loading" class="messages-hint">{{ t('chat.loadingMessages') }}</div>
          <div v-else-if="showMessageSearch && messageSearchQuery && !filteredMessages.length" class="messages-hint">{{ t('chat.noMatchingMessages') }}</div>
          <div v-else-if="!messages.length" class="messages-hint">{{ t('chat.noMessages') }}</div>

          <template v-for="(msg, index) in (showMessageSearch && messageSearchQuery ? filteredMessages : messages)" :key="msg.id">
            <div v-if="shouldShowDateDivider(messages, index)" class="chat-date-divider">
              <span>{{ formatLocaleDate(msg.createdAt) }}</span>
            </div>
            <article
              :data-message-id="msg.id"
              class="message-row"
              :class="{
                'message-row--own': isOwnMessage(msg),
                'message-row--moderatable': canModerateMessages,
                'message-row--new-loaded': recentlyLoadedIds.has(msg.id)
              }"
            >
              <UiAvatar
                v-if="!isOwnMessage(msg)"
                class="message-avatar"
                :src="msg.sender.avatarUrl"
                :alt="msg.sender.displayName"
                :fallback="msg.sender.displayName"
                size="sm"
                @click="previewAvatar(msg.sender)"
              />
              <div
                class="message-bubble"
                :class="{
                  'message-bubble--with-attachment': msg.attachment,
                  'message-bubble--highlighted': Number(highlightedMessageId) === Number(msg.id)
                }"
                @contextmenu="openMessageContextMenu($event, msg)"
                @pointerdown="startMessageLongPress($event, msg)"
                @pointermove="trackMessageLongPress"
                @pointerup="cancelMessageLongPress"
                @pointercancel="cancelMessageLongPress"
              >
                <div v-if="activeRoom.kind !== 'dm' && !isOwnMessage(msg)" class="message-sender-name">
                  <span>{{ msg.sender.displayName }}</span>
                  <SenderSourceBadge :source="msg.sender.source" />
                </div>
                <p v-if="msg.content">
                  <MentionText
                    :content="msg.content"
                    :mentions="msg.mentions"
                    :current-user-id="session?.userId"
                  />
                </p>
                <MessageAttachment v-if="msg.attachment" :attachment="msg.attachment" />
                <span class="message-time">{{ formatBubbleTime(msg.createdAt) }}</span>
              </div>
            </article>
          </template>
        </section>

        <button
          v-if="showScrollToBottom"
          type="button"
          class="scroll-to-bottom-btn"
          title="下滑到底部"
          aria-label="下滑到底部"
          @click="scrollToBottomSmooth"
        >
          <ChevronDown :size="20" aria-hidden="true" />
        </button>

        <MessageContextMenu
          :open="Boolean(messageMenu.message)"
          :x="messageMenu.x"
          :y="messageMenu.y"
          :can-pin="canPinMessages"
          :pinned="selectedMessageIsPinned"
          :can-delete="canDeleteSelectedMessage"
          @close="closeMessageMenu"
          @copy="copySelectedMessage"
          @select-text="openSelectTextModal"
          @pin="pinSelectedMessage"
          @unpin="unpinSelectedMessage"
          @delete="confirmDeleteMessage"
        />

		<MessageComposer
		  v-model="composerText"
		  :pending-attachment="pendingAttachment"
		  :is-uploading="isUploadingAttachment"
		  :upload-progress="uploadProgress"
		  :sending="sending"
			  :disabled="!activeRoom"
			  :error="error"
			  :mention-candidates="mentionCandidates"
			  @send="sendComposerMessage"
		  @upload="uploadAttachment"
		  @clear-attachment="clearAttachment"
		/>
      </template>

      <div v-else class="chat-empty">
        <LanguageSwitch class="chat-empty__language-switch" />
        <div class="empty-content">
          <div class="empty-brand">
            <span class="empty-title">{{ siteName }}</span>
          </div>
        </div>
      </div>
    </main>

    <div v-if="showMemberPanel" class="room-management-layer" @click.self="closeMemberPanel">
      <aside class="room-management-sidebar">
        <MemberPanel
          :room="activeRoom"
          :members="groupMembers"
          :loading="memberLoading"
          :can-manage="canManageActiveRoom"
          :invite-user-id="inviteUserId"
          :available-invite-users="availableInviteUsers"
          :invite-submitting="inviteSubmitting"
          @close="closeMemberPanel"
          @update:invite-user-id="inviteUserId = $event"
          @invite="inviteMember"
          @remove-member="removeMember"
          @delete-group="deleteGroup"
          @preview-avatar="previewAvatar"
        />
      </aside>
    </div>

    <MobileNavigationDrawer
      :show="showMobileNavigation"
      :session="session"
      :show-admin="showAdminEntry"
      :notifications-enabled="notificationsEnabled"
      :notification-label="notificationActionLabel"
      :notification-disabled="notificationToggleDisabled"
      @close="closeMobileNavigation"
      @settings="navigateFromMobileDrawer(openSettings)"
      @admin="navigateFromMobileDrawer(openAdmin)"
      @notification="toggleNotifications"
      @logout="navigateFromMobileDrawer(logout)"
    />

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="avatarPreviewModal.open"
          class="avatar-modal-overlay"
          role="dialog"
          aria-modal="true"
          @click.self="closeAvatarPreviewModal"
        >
          <div class="avatar-modal-card">
            <button
              type="button"
              class="avatar-modal-close"
              :aria-label="t('common.close')"
              @click="closeAvatarPreviewModal"
            >
              <X :size="20" aria-hidden="true" />
            </button>
            <div class="avatar-modal-header">
              <h3>{{ avatarPreviewModal.name }}</h3>
            </div>
            <div class="avatar-modal-body">
              <img
                v-if="avatarPreviewModal.src"
                :src="avatarPreviewModal.src"
                :alt="avatarPreviewModal.name"
                class="avatar-modal-img"
              />
              <div v-else class="avatar-modal-fallback">
                <span>{{ avatarPreviewModal.fallback }}</span>
              </div>
            </div>
            <div v-if="avatarPreviewModal.user" class="avatar-modal-footer">
              <UiButton
                variant="secondary"
                size="sm"
                class="avatar-dm-button"
                @click="startDirectMessageFromAvatar"
              >
                <MessageSquare :size="16" aria-hidden="true" />
                {{ t('chat.startDirectMessage') }}
              </UiButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="textSelectionModal.open"
          class="avatar-modal-overlay"
          role="dialog"
          aria-modal="true"
          @click.self="closeSelectTextModal"
        >
          <div class="avatar-modal-card text-selection-card">
            <button
              type="button"
              class="avatar-modal-close"
              :aria-label="t('common.close')"
              @click="closeSelectTextModal"
            >
              <X :size="20" aria-hidden="true" />
            </button>
            <div class="avatar-modal-header">
              <h3>{{ t('messages.selectText') }}</h3>
            </div>
            <div class="text-selection-body">
              <textarea
                readonly
                class="text-selection-area"
                :value="textSelectionModal.text"
                @focus="$event.target.select()"
              ></textarea>
            </div>
            <div class="avatar-modal-footer">
              <UiButton
                variant="primary"
                size="sm"
                class="avatar-dm-button"
                @click="copyTextSelectionModalText"
              >
                {{ t('messages.copy') }}
              </UiButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <AddConversationDialog
      :show="showAddConversation"
      :users="usersWithoutDm"
      :opening-dm-user-id="openingDmUserId"
      :error="error"
      @close="closeAddConversation"
      @create-group="startGroupCreation"
      @open-dm="openDm"
    />

    <CreateGroupDialog
      :show="showCreateGroup"
      :users="users"
      :form="createGroupForm"
      :submitting="creatingGroup"
      @close="closeCreateGroup"
      @toggle-member="toggleCreateGroupMember"
      @submit="createGroup"
    />

    <PublicGroupJoinDialog
      :show="Boolean(publicGroupPreview)"
      :channel="publicGroupPreview"
      :joining="joiningPublicGroup"
      @close="closePublicGroupPreview"
      @join="confirmPublicGroupJoin"
    />

    <GroupSettingsDialog
      :show="showGroupEditor"
      :room="activeRoom"
      :form="groupSettingsForm"
      :saving="groupSettingsSaving"
      :avatar-uploading="groupAvatarUploading"
      @close="closeGroupEditor"
      @upload-avatar="uploadGroupAvatar"
      @save="saveGroupSettings"
    />
  </div>
</template>

<style scoped>
.chat-layout {
  position: fixed;
  top: var(--chat-viewport-offset-top, 0px);
  left: 0;
  display: flex;
  width: 100%;
  height: var(--chat-viewport-height, 100dvh);
  min-height: 100dvh;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
  background: #efeae2;
}

.left-sidebar {
  flex-shrink: 0;
  width: 350px;
  height: 100%;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #ffffff;
  border-right: 1px solid #e9edef;
}

.left-sidebar .sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  background: #ffffff;
}

.mobile-menu-action {
  display: none;
}

.brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #008069;
  font-family: system-ui, -apple-system, sans-serif;
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mobile-language-switch {
  display: none;
}

.header-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  text-decoration: none;
  transition: background 150ms, color 150ms;
}

.header-action:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.header-action:active,
.chat-header__button:active {
  background: rgba(0, 0, 0, 0.08);
}

.sidebar-section {
  flex-shrink: 0;
}

.sidebar-divider {
  flex-shrink: 0;
  height: 1px;
  background: #f0f2f5;
}

.right-sidebar {
  flex-shrink: 0;
  width: 68px;
  height: 100%;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #f0f2f5;
  border-right: 1px solid #e9edef;
}

.right-sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #f0f2f5;
  padding: 16px 8px;
  align-items: center;
}

.right-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  width: 100%;
}

.right-sidebar-user-group {
  margin-top: auto;
}

.right-sidebar-action,
.right-sidebar-user {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms, transform 150ms;
  padding: 0;
  position: relative;
  touch-action: manipulation;
}

.right-sidebar-action:hover,
.right-sidebar-user:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.right-sidebar-action--danger:hover {
  background: rgba(254, 242, 242, 0.8);
  color: #dc2626;
}

.right-sidebar-action--admin,
.right-sidebar-action--labeled {
  width: 52px;
  height: 56px;
  gap: 4px;
  border-radius: 8px;
}

.right-sidebar-action--admin {
  flex-direction: column;
}

.right-sidebar-action--labeled {
  flex-direction: column;
}

.right-sidebar-action--notification-active {
  background: rgba(0, 128, 105, 0.1);
  color: #008069;
}

.right-sidebar-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.right-sidebar-action__label {
  max-width: 100%;
  font-size: 10px;
  line-height: 1.1;
  overflow-wrap: anywhere;
  text-align: center;
}

.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 120%;
  top: 50%;
  transform: translateY(-50%);
  background: #333;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tooltip:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(4px);
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #efeae2;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #f0f2f5;
  border-bottom: 1px solid #e9edef;
}

.chat-header__back {
  display: none;
}

.chat-header__avatar {
  flex: 0 0 auto;
}

.chat-header__identity {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.chat-header__identity span {
  overflow: hidden;
  color: #667781;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.chat-header__language-switch {
  width: 36px;
  min-width: 36px;
  height: 36px;
}

.chat-header__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #d8dee2;
  border-radius: 8px;
  background: #fff;
  color: #54656f;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
  touch-action: manipulation;
}

.chat-header__button:hover {
  background: #f5f7fa;
  border-color: #c7d0d6;
  color: #111b21;
}

.chat-header__button--active {
  border-color: rgba(0, 128, 105, 0.28);
  background: rgba(0, 128, 105, 0.08);
  color: #008069;
}

.header-action:focus-visible {
  outline: 2px solid #008069;
  outline-offset: 2px;
}

.header-action img {
  display: block;
  width: 20px;
  height: 20px;
}

.chat-header h2 {
  margin: 0;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111b21;
  background: transparent;
  border-radius: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
}

.chat-header__status.online {
  background: #10b981;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px;
  overscroll-behavior-y: none;
  scrollbar-gutter: stable;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.chat-messages::-webkit-scrollbar { width: 6px; }
.chat-messages::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }

.scroll-to-bottom-btn {
  position: absolute;
  right: 24px;
  bottom: 76px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid #e9edef;
  border-radius: 50%;
  background: #ffffff;
  color: #54656f;
  box-shadow: 0 3px 10px rgba(11, 20, 26, 0.18);
  cursor: pointer;
  transition: transform 180ms ease, background 150ms, color 150ms;
}

.scroll-to-bottom-btn:hover {
  background: #f5f6f6;
  color: #111b21;
  transform: translateY(-2px);
}

.scroll-to-bottom-btn:active {
  transform: translateY(0);
}

.load-more-btn {
  display: block;
  margin: 0 auto 16px;
  padding: 6px 16px;
  border: 1px solid #e8ecf0;
  border-radius: 16px;
  background: #fff;
  color: #54656f;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.load-more-btn:hover {
  background: #f5f7fa;
  border-color: #d1d5db;
}

.messages-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: #8696a0;
  font-size: 14px;
}

.chat-date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 16px 0 12px;
  text-align: center;
  user-select: none;
}

.chat-date-divider span {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  color: #54656f;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
  width: 100%;
  justify-content: flex-start;
}

.message-row--own {
  justify-content: flex-end;
}

.message-bubble--highlighted {
  outline: 3px solid rgba(0, 128, 105, 0.3);
  outline-offset: 3px;
  transition: outline-color 180ms ease;
}

.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  box-shadow: none;
}

.message-bubble {
  max-width: 65%;
  padding: 6px 10px 7px;
  border-radius: 8px;
  background: #ffffff;
  border: none;
  position: relative;
  word-break: break-word;
  box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.message-row--moderatable .message-bubble {
  touch-action: pan-y;
  -webkit-touch-callout: none;
}

.message-bubble--with-attachment {
  padding-bottom: 20px;
}

.message-row--own .message-bubble {
  background: #d9fdd3;
}

.message-sender-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: #008069;
  margin-bottom: 4px;
}

.message-time {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 11px;
  line-height: 1;
  color: #667781;
  white-space: nowrap;
  user-select: none;
}

.message-bubble p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.45;
  color: #111b21;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 短消息在末行预留时间戳宽度，避免气泡收缩后正文与右下角时间重叠。 */
.message-bubble:not(.message-bubble--with-attachment) p::after {
  content: '';
  display: inline-block;
  width: 3.5em;
  height: 0;
}

.chat-empty {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-empty__language-switch {
  position: absolute;
  top: 10px;
  right: 16px;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.3;
  user-select: none;
}

.empty-title {
  font-size: 28px;
  font-weight: 400;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-style: italic;
  letter-spacing: 0.02em;
  color: #111b21;
}

.room-management-layer {
  width: 340px;
  flex-shrink: 0;
  height: 100%;
}

.room-management-sidebar {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: #f7f9fa;
  border-left: 1px solid #e9edef;
  touch-action: pan-y;
}

@media (max-width: 960px) {
  .chat-layout {
    min-height: 0;
    background: #ffffff;
  }

  .right-sidebar {
    display: none;
  }

  .left-sidebar {
    width: 100%;
    max-width: none;
    border-right: 0;
  }

  .chat-main {
    width: 100%;
    flex: 0 0 100%;
  }

  .chat-layout--mobile-list .chat-main,
  .chat-layout--mobile-chat .left-sidebar {
    display: none;
  }

  .sidebar-header {
    min-height: 64px;
    gap: 8px;
    padding:
      max(8px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      8px
      max(8px, env(safe-area-inset-left));
  }

  .mobile-menu-action {
    display: flex;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
  }

  .brand-title {
    flex: 1;
    min-width: 0;
    font-size: 21px;
  }

  .header-action {
    flex-basis: 44px;
    width: 44px;
    height: 44px;
  }

  .header-action--github {
    display: none;
  }

  .sidebar-header-actions {
    gap: 0;
  }

  .mobile-language-switch {
    display: inline-grid;
  }

  .chat-header {
    min-height: 64px;
    gap: 8px;
    padding:
      max(8px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      8px
      max(4px, env(safe-area-inset-left));
  }

  .chat-header__back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #111b21;
    touch-action: manipulation;
  }

  .chat-header__back:active {
    background: rgba(0, 0, 0, 0.08);
  }

  .chat-header__avatar {
    flex: 0 0 36px;
  }

  .chat-header__identity h2 {
    font-size: 15px;
  }

  .chat-header__button {
    width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .chat-header__button span {
    display: none;
  }

  .chat-header__status {
    width: 7px;
    height: 7px;
  }

  .chat-header__actions {
    gap: 0;
  }

  .chat-header__language-switch {
    width: 44px;
    min-width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .chat-messages {
    padding: 14px max(10px, env(safe-area-inset-right)) 18px max(10px, env(safe-area-inset-left));
    scrollbar-gutter: auto;
  }

  .scroll-to-bottom-btn {
    right: 16px;
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    z-index: 10;
  }

  .message-row {
    margin-bottom: 8px;
  }

  .message-row--new-loaded {
    animation: loadOlderFadeIn 300ms ease-out forwards;
  }

  @keyframes loadOlderFadeIn {
    from {
      opacity: 0.15;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message-bubble {
    max-width: 88%;
  }

  .room-management-layer {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    justify-content: flex-end;
    width: auto;
    height: auto;
    padding-left: 48px;
    background: rgba(11, 20, 26, 0.35);
  }

  .room-management-sidebar {
    width: min(360px, 100%);
    height: 100%;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: -12px 0 30px rgba(11, 20, 26, 0.16);
  }

  .chat-search-bar__input {
    font-size: 16px;
    height: 36px;
  }
}

@media (max-width: 380px) {
  .chat-header__avatar,
  .chat-header__status {
    display: none;
  }

  .chat-header {
    gap: 4px;
  }

  .message-bubble {
    max-width: 92%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .header-action,
  .chat-header__button,
  .message-bubble--highlighted {
    transition: none;
  }
}

.chat-header__button--active {
  background: rgba(0, 128, 105, 0.12);
  color: #008069;
}

.chat-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #f0f2f5;
  border-bottom: 1px solid #e9edef;
  flex-shrink: 0;
}

.chat-search-bar__icon {
  color: #54656f;
  flex-shrink: 0;
}

.chat-search-bar__input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e9edef;
  border-radius: 6px;
  background: #ffffff;
  color: #111b21;
  font-size: 14px;
  outline: none;
}

.chat-search-bar__input:focus {
  border-color: #008069;
}

.chat-search-bar__count {
  font-size: 12px;
  color: #667781;
  white-space: nowrap;
}

.chat-search-bar__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
}

.chat-search-bar__close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #111b21;
}

.avatar-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(11, 20, 26, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.avatar-modal-card {
  position: relative;
  width: min(360px, 90vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  animation: modalScale 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes modalScale {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.avatar-modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.avatar-modal-close:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #111b21;
}

.avatar-modal-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #111b21;
  text-align: center;
}

.avatar-modal-body {
  width: 240px;
  height: 240px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}

.avatar-modal-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-modal-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #008069 0%, #10b981 100%);
  color: #ffffff;
  font-size: 64px;
  font-weight: 700;
}

.avatar-modal-footer {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

.avatar-dm-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.text-selection-card {
  width: min(440px, 92vw);
}

.text-selection-body {
  width: 100%;
}

.text-selection-area {
  width: 100%;
  min-height: 140px;
  max-height: 280px;
  padding: 12px;
  border: 1px solid #e8ecf0;
  border-radius: 12px;
  background: #f9fafb;
  color: #111b21;
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
  user-select: text;
  -webkit-user-select: text;
}
</style>
