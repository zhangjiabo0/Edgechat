import { ref } from "vue";

export function useChatViewport({ activeRoom }) {
	const isMobileViewport = ref(false);
	const mobileView = ref("list");
	let viewportInitialized = false;
	let resetScrollTimers = [];

	function clearResetScrollTimers() {
		for (const timer of resetScrollTimers) {
			clearTimeout(timer);
		}
		resetScrollTimers = [];
	}

	/**
	 * iOS Safari 在虚拟键盘弹起/关闭时会给 window/document/body 产生一个向下的 scrollTop
	 * 偏移量，导致 position:fixed 的布局容器被推出可视区域，或者导致点击测试（Hit-Testing）脱节。
	 * 强制将全局滚动位置清零。
	 */
	function resetWindowScroll() {
		if (typeof window === "undefined") return;
		let shouldScroll = false;
		if ((window.scrollY || 0) !== 0 || (window.scrollX || 0) !== 0) {
			shouldScroll = true;
		}
		if (
			typeof document !== "undefined" &&
			document.documentElement &&
			(document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0)
		) {
			document.documentElement.scrollTop = 0;
			document.documentElement.scrollLeft = 0;
			shouldScroll = true;
		}
		if (
			typeof document !== "undefined" &&
			document.body &&
			(document.body.scrollTop !== 0 || document.body.scrollLeft !== 0)
		) {
			document.body.scrollTop = 0;
			document.body.scrollLeft = 0;
			shouldScroll = true;
		}
		if (shouldScroll && typeof window.scrollTo === "function") {
			window.scrollTo(0, 0);
		}
	}

	function syncViewportState() {
		const nextIsMobile = window.innerWidth <= 960;
		if (viewportInitialized && nextIsMobile === isMobileViewport.value) {
			return;
		}

		viewportInitialized = true;
		isMobileViewport.value = nextIsMobile;
		mobileView.value = nextIsMobile && !activeRoom.value ? "list" : "chat";
	}

	function syncViewportHeight() {
		// 先重置全局滚动，避免 visualViewport.offsetTop 读到由于页面滚动引起的伪偏移
		resetWindowScroll();

		const visualViewport = window.visualViewport;
		const viewportHeight = visualViewport?.height || window.innerHeight;
		// 部分移动浏览器会在键盘弹出时平移视觉视口，只同步高度会让输入栏停在旧位置。
		document.documentElement.style.setProperty(
			"--chat-viewport-height",
			`${Math.round(viewportHeight)}px`,
		);
		document.documentElement.style.setProperty(
			"--chat-viewport-offset-top",
			`${Math.round(visualViewport?.offsetTop || 0)}px`,
		);

		resetWindowScroll();
	}

	/**
	 * 在键盘关闭、发送消息、点击收起键盘等多事件触发时，
	 * 分多次在动画周期内（50ms, 150ms, 300ms, 500ms）强制重置并校准视口。
	 */
	function calibrateViewport() {
		clearResetScrollTimers();
		resetWindowScroll();
		syncViewportHeight();

		const delays = [50, 150, 300, 500];
		for (const delay of delays) {
			const timer = setTimeout(() => {
				resetWindowScroll();
				syncViewportHeight();
			}, delay);
			resetScrollTimers.push(timer);
		}
	}

	function handleFocusOut(event) {
		const target = event?.target;
		if (
			!target ||
			(target.tagName !== "INPUT" &&
				target.tagName !== "TEXTAREA" &&
				!target.isContentEditable)
		) {
			return;
		}
		calibrateViewport();
	}

	function startViewportSync() {
		syncViewportState();
		syncViewportHeight();
		window.addEventListener("resize", syncViewportState);
		window.addEventListener("resize", syncViewportHeight);
		window.visualViewport?.addEventListener?.("resize", syncViewportHeight);
		window.visualViewport?.addEventListener?.("scroll", syncViewportHeight);
		document?.addEventListener?.("focusout", handleFocusOut, true);
	}

	function stopViewportSync() {
		window.removeEventListener("resize", syncViewportState);
		window.removeEventListener("resize", syncViewportHeight);
		window.visualViewport?.removeEventListener?.("resize", syncViewportHeight);
		window.visualViewport?.removeEventListener?.("scroll", syncViewportHeight);
		document?.removeEventListener?.("focusout", handleFocusOut, true);
		clearResetScrollTimers();
		document.documentElement?.style?.removeProperty?.("--chat-viewport-height");
		document.documentElement?.style?.removeProperty?.("--chat-viewport-offset-top");
	}

	function openConversationView() {
		if (isMobileViewport.value) {
			mobileView.value = "chat";
		}
	}

	function returnToConversationList() {
		if (isMobileViewport.value) {
			mobileView.value = "list";
		}
		if (activeRoom) {
			activeRoom.value = null;
		}
	}

	return {
		isMobileViewport,
		mobileView,
		startViewportSync,
		stopViewportSync,
		openConversationView,
		returnToConversationList,
		calibrateViewport,
		resetWindowScroll,
	};
}
