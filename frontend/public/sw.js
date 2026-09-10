/* eslint-disable no-restricted-globals */
// Service Worker for Edgechat Web Push Notifications

self.addEventListener("install", (event) => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
	let data = {};
	if (event.data) {
		try {
			data = event.data.json();
		} catch {
			data = { title: "Edgechat", body: event.data.text() };
		}
	}

	const title = data.title || "Edgechat";
	const options = {
		body: data.body || "您收到了新消息",
		icon: data.icon || "/logo.svg",
		badge: data.badge || "/logo.svg",
		tag: data.tag || "edgechat-notification",
		data: data.url || "/",
		renotify: true,
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const targetUrl = event.notification.data || "/";

	event.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
			for (const client of clientList) {
				if ("focus" in client) {
					if (client.url.includes(self.location.origin)) {
						return client.focus();
					}
				}
			}
			if (self.clients.openWindow) {
				return self.clients.openWindow(targetUrl);
			}
		}),
	);
});
