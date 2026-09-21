import { ref } from "vue";

export function useChatViewport({ activeRoom }) {
	const isMobileViewport = ref(false);
	const mobileView = ref("list");
	let viewportInitialized = false;
	let resetScrollTimer = null;

	/**
	 * iOS Safari 在虚拟键盘关闭时会给 window 产生一个向下的 scrollTop
	 * 偏移量，导致 position:fixed 的布局容器被推出可视区域。
	 * 强制将 window 滚回 (0,0) 来消除此偏移。
	 */
	function resetWindowScroll() {
		if (window.scrollY !== 0 || window.scrollX !== 0) {
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
		// iOS Safari: 键盘弹出/关闭时可能产生页面级偏移，立即修正
		resetWindowScroll();
	}

	/**
	 * 处理输入框失焦事件（键盘关闭）。
	 * iOS Safari 在键盘关闭动画期间会分多次调整视口，单次重置可能不够，
	 * 需要延迟多次以覆盖整个关闭动画周期（约 300-400ms）。
	 */
	function handleFocusOut(event) {
		const target = event.target;
		if (
			!target ||
			(target.tagName !== "INPUT" &&
				target.tagName !== "TEXTAREA" &&
				!target.isContentEditable)
		) {
			return;
		}
		if (resetScrollTimer) {
			clearTimeout(resetScrollTimer);
		}
		// 立即重置一次
		resetWindowScroll();
		// 在键盘关闭动画的不同阶段各重置一次
		const delays = [50, 150, 300, 500];
		let i = 0;
		function scheduleNext() {
			if (i >= delays.length) {
				resetScrollTimer = null;
				return;
			}
			resetScrollTimer = setTimeout(() => {
				resetWindowScroll();
				syncViewportHeight();
				i++;
				scheduleNext();
			}, delays[i] - (i > 0 ? delays[i - 1] : 0));
		}
		scheduleNext();
	}

	function startViewportSync() {
		syncViewportState();
		syncViewportHeight();
		window.addEventListener("resize", syncViewportState);
		window.addEventListener("resize", syncViewportHeight);
		window.visualViewport?.addEventListener("resize", syncViewportHeight);
		window.visualViewport?.addEventListener("scroll", syncViewportHeight);
		document.addEventListener("focusout", handleFocusOut, true);
	}

	function stopViewportSync() {
		window.removeEventListener("resize", syncViewportState);
		window.removeEventListener("resize", syncViewportHeight);
		window.visualViewport?.removeEventListener("resize", syncViewportHeight);
		window.visualViewport?.removeEventListener("scroll", syncViewportHeight);
		document.removeEventListener("focusout", handleFocusOut, true);
		if (resetScrollTimer) {
			clearTimeout(resetScrollTimer);
			resetScrollTimer = null;
		}
		document.documentElement.style.removeProperty("--chat-viewport-height");
		document.documentElement.style.removeProperty("--chat-viewport-offset-top");
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
	};
}

