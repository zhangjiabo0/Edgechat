import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useChatViewport } from "../frontend/src/composables/useChatViewport.js";

function createBrowser(width, height = 760) {
	const listeners = new Map();
	const viewportListeners = new Map();
	const properties = new Map();
	function addListener(collection, type, listener) {
		const current = collection.get(type) || new Set();
		current.add(listener);
		collection.set(type, current);
	}
	function removeListener(collection, type, listener) {
		const current = collection.get(type);
		current?.delete(listener);
		if (!current?.size) {
			collection.delete(type);
		}
	}
	globalThis.window = {
		innerWidth: width,
		innerHeight: height,
		scrollX: 0,
		scrollY: 0,
		scrollTo(x, y) {
			this.scrollX = x;
			this.scrollY = y;
		},
		addEventListener(type, listener) {
			addListener(listeners, type, listener);
		},
		removeEventListener(type, listener) {
			removeListener(listeners, type, listener);
		},
		visualViewport: {
				height,
				offsetTop: 0,
			addEventListener(type, listener) {
				addListener(viewportListeners, type, listener);
			},
			removeEventListener(type, listener) {
				removeListener(viewportListeners, type, listener);
			},
		},
	};
	globalThis.document = {
		documentElement: {
			scrollTop: 0,
			scrollLeft: 0,
			style: {
				setProperty(name, value) {
					properties.set(name, value);
				},
				removeProperty(name) {
					properties.delete(name);
				},
			},
		},
		body: {
			scrollTop: 0,
			scrollLeft: 0,
		},
		addEventListener(type, listener) {
			addListener(listeners, type, listener);
		},
		removeEventListener(type, listener) {
			removeListener(listeners, type, listener);
		},
	};
	return { listeners, viewportListeners, properties };
}

test("移动端首次进入只显示会话列表，选择后可进入并返回", () => {
	const browser = createBrowser(375, 740);
	const activeRoom = ref(null);
	const viewport = useChatViewport({ activeRoom });

	viewport.startViewportSync();
	assert.equal(viewport.isMobileViewport.value, true);
	assert.equal(viewport.mobileView.value, "list");
	assert.equal(browser.properties.get("--chat-viewport-height"), "740px");
	assert.equal(browser.properties.get("--chat-viewport-offset-top"), "0px");

	window.visualViewport.height = 420;
	window.visualViewport.offsetTop = 96;
	for (const listener of browser.viewportListeners.get("scroll")) {
		listener();
	}
	assert.equal(browser.properties.get("--chat-viewport-height"), "420px");
	assert.equal(browser.properties.get("--chat-viewport-offset-top"), "96px");

	activeRoom.value = { kind: "dm", id: 3 };
	viewport.openConversationView();
	assert.equal(viewport.mobileView.value, "chat");
	viewport.returnToConversationList();
	assert.equal(viewport.mobileView.value, "list");
	assert.equal(activeRoom.value, null);

	viewport.stopViewportSync();
	assert.equal(browser.listeners.size, 0);
	assert.equal(browser.viewportListeners.size, 0);
	assert.equal(browser.properties.has("--chat-viewport-height"), false);
	assert.equal(browser.properties.has("--chat-viewport-offset-top"), false);
});

test("桌面端保持聊天视图并在缩窄后保留已选会话", () => {
	const browser = createBrowser(1280);
	const activeRoom = ref({ kind: "public", id: 1 });
	const viewport = useChatViewport({ activeRoom });

	viewport.startViewportSync();
	assert.equal(viewport.isMobileViewport.value, false);
	assert.equal(viewport.mobileView.value, "chat");

	window.innerWidth = 414;
	for (const listener of browser.listeners.get("resize")) {
		listener();
	}
	assert.equal(viewport.isMobileViewport.value, true);
	assert.equal(viewport.mobileView.value, "chat");
	viewport.stopViewportSync();
});

test("视口同步时会重置 window 滚动位置并防止页面级滚动偏移", () => {
	const browser = createBrowser(375, 740);
	const activeRoom = ref(null);
	const viewport = useChatViewport({ activeRoom });

	window.scrollY = 120;
	window.scrollX = 10;
	viewport.startViewportSync();
	assert.equal(window.scrollY, 0);
	assert.equal(window.scrollX, 0);

	window.scrollY = 80;
	for (const listener of browser.viewportListeners.get("scroll")) {
		listener();
	}
	assert.equal(window.scrollY, 0);

	viewport.stopViewportSync();
});

test("calibrateViewport 能主动校准视口并清除 document 与 body 的残留滚动", () => {
	const browser = createBrowser(375, 740);
	const activeRoom = ref(null);
	const viewport = useChatViewport({ activeRoom });

	viewport.startViewportSync();
	window.scrollY = 250;
	document.documentElement.scrollTop = 250;
	document.body.scrollTop = 250;

	viewport.calibrateViewport();
	assert.equal(window.scrollY, 0);
	assert.equal(document.documentElement.scrollTop, 0);
	assert.equal(document.body.scrollTop, 0);

	viewport.stopViewportSync();
});


