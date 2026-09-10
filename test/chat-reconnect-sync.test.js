import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useChatRoom } from "../frontend/src/composables/useChatRoom.js";
import { useUnreadInbox } from "../frontend/src/composables/useUnreadInbox.js";

function createSocket(params, handlers) {
	return {
		params,
		handlers,
		sentFrames: [],
		readyState: 1,
		close() {
			this.readyState = 3;
			handlers.onStatus({ status: "closed", socket: this });
		},
		send(frame) {
			this.sentFrames.push(JSON.parse(frame));
		},
		emitMessage(message) {
			handlers.onMessage(JSON.stringify(message), this);
		},
		emitStatus(status) {
			handlers.onStatus({ status, socket: this });
		},
	};
}

test("WebSocket 断线重连时自动增量补拉与去重合并历史消息（解决漏消息 Bug）", async () => {
	const activeRoom = ref({ id: 1, kind: "public" });
	const sockets = [];
	let getMessagesCallCount = 0;
	let returnedHistory = [{ id: 1, content: "Message 1" }, { id: 2, content: "Message 2" }];

	const room = useChatRoom({
		activeRoom,
		session: ref({ userId: 7 }),
		error: ref(""),
		roomApi: {
			async getMessages() {
				getMessagesCallCount++;
				return { messages: returnedHistory };
			},
			async markRoomRead() {},
		},
		openRoomConnection(params) {
			const socket = createSocket(params, params);
			sockets.push(socket);
			return socket;
		},
	});

	// 1. 初始化激活房间
	const activatePromise = room.activateRoom();
	sockets[0].emitStatus("open");
	await activatePromise;

	assert.equal(room.messages.value.length, 2);
	assert.deepEqual(room.messages.value.map(m => m.id), [1, 2]);

	// 2. 断线期间后端产生了新消息 ID 3 (在断线/锁屏窗口内)
	returnedHistory = [
		{ id: 1, content: "Message 1" },
		{ id: 2, content: "Message 2" },
		{ id: 3, content: "Message 3 (missed during lock)" },
	];

	// 3. 模拟切前台手动触发 syncLatestMessages 或重连
	await room.syncLatestMessages();

	// 验证消息列表中无缝合并了断线期间缺失的消息 3
	assert.equal(room.messages.value.length, 3);
	assert.deepEqual(room.messages.value.map(m => m.id), [1, 2, 3]);

	// 4. 再次收到重连后的实时推送消息 4
	sockets[0].emitMessage({ type: "message", message: { id: 4, content: "Message 4", sender: { id: 1, kind: "local" } } });
	assert.equal(room.messages.value.length, 4);
	assert.deepEqual(room.messages.value.map(m => m.id), [1, 2, 3, 4]);
});

test("useUnreadInbox 重连时会触发 onReconnected 回调", async () => {
	let reconnectedCalled = false;
	let socketInstance = null;

	const inbox = useUnreadInbox({
		activeRoom: ref(null),
		applyConversationActivity() {},
		markConversationRead() {},
		openInboxConnection(handlers) {
			socketInstance = createSocket({}, handlers);
			return socketInstance;
		},
		onReconnected() {
			reconnectedCalled = true;
		},
	});

	inbox.connectUnreadInbox();
	socketInstance.emitStatus("open");
	assert.equal(reconnectedCalled, true);
});
