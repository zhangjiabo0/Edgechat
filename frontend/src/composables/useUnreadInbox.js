import api from "../api.js";
import { createRealtimeSession } from "../realtime-session.js";
import { connectInboxSocket } from "../ws.js";

export function useUnreadInbox({
  activeRoom,
  applyConversationActivity,
  markConversationRead,
	roomApi = api,
	openInboxConnection = connectInboxSocket,
	notifyRoom = () => {},
	onReconnected = () => {},
	isPageActive = () =>
		globalThis.document?.visibilityState === "visible" &&
		globalThis.document.hasFocus(),
	isViewingChat = () => true,
}) {
  function isActiveRoom(room) {
    if (!isViewingChat()) {
      return false;
    }
    return (
      activeRoom.value &&
      activeRoom.value.kind === room.kind &&
      Number(activeRoom.value.id) === Number(room.id)
    );
  }

		let inboxStatus = "closed";
		const inboxSession = createRealtimeSession({
			openConnection(_params, handlers) {
				return openInboxConnection(handlers);
			},
			onStatus(event) {
				const previousStatus = inboxStatus;
				inboxStatus = event.status === "reconnecting" ? "connecting" : event.status;
				if (event.status === "open" && previousStatus !== "open") {
					onReconnected();
				}
			},
			onMessage(payload) {
        if (payload.type !== 'room_message' || !payload.room) {
          return;
        }

			if (isActiveRoom(payload.room) && isPageActive()) {
				markConversationRead(payload.room.kind, payload.room.id);
				void roomApi
					.markRoomRead(payload.room.kind, payload.room.id, payload.messageId)
					.catch(() => {});
			return;
		}

        applyConversationActivity({
          kind: payload.room.kind,
          roomId: payload.room.id,
          lastMessageAt: payload.createdAt,
          lastMessageContent: payload.contentPreview,
          lastMessageSenderName: payload.sender?.displayName || payload.sender?.username,
          unreadCount: payload.unreadCount,
          mentionUnreadCount: payload.mentionUnreadCount
        });
				notifyRoom(payload);
			},
		});

	function connectUnreadInbox() {
		inboxSession.connect("inbox");
	}

  return {
    connectUnreadInbox,
		disconnectUnreadInbox: inboxSession.disconnect,
  };
}
