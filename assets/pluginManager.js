(function() {
	//#region hook/pluginManager.ts
	var ITEM_ID = "sidra-plugin-manager-menu-item";
	var MENU_SELECTOR = "amp-contextual-menu";
	var LIST_SELECTOR = "ul.contextual-menu__list[role=\"menu\"]";
	var OPTION_TEXT_SELECTOR = ".contextual-menu-item__option-text";
	function sendNavigation(channel) {
		if (window.AMWrapper?.ipcRenderer) {
			window.AMWrapper.ipcRenderer.send(channel);
			return;
		}
		if (window.SidraAndroid?.postMessage) {
			window.SidraAndroid.postMessage(channel);
			return;
		}
		console.warn(`[Sidra] no host bridge available for "${channel}"`);
	}
	function injectPluginManagerItem(menu) {
		if (document.getElementById(ITEM_ID)) return;
		const list = menu.querySelector(LIST_SELECTOR);
		if (!list) return;
		const signOutItem = Array.from(list.querySelectorAll(OPTION_TEXT_SELECTOR)).find((element) => element.textContent?.trim() === "Sign Out")?.closest("amp-contextual-menu-item");
		if (!signOutItem) return;
		const wrapper = document.createElement("amp-contextual-menu-item");
		wrapper.id = ITEM_ID;
		wrapper.setAttribute("hydrated", "");
		const item = document.createElement("li");
		item.className = "contextual-menu-item";
		const button = document.createElement("button");
		button.type = "button";
		const optionWrapper = document.createElement("span");
		optionWrapper.className = "contextual-menu-item__option-wrapper";
		const optionText = document.createElement("span");
		optionText.className = "contextual-menu-item__option-text";
		optionText.textContent = "Plugin Manager";
		optionWrapper.appendChild(optionText);
		button.appendChild(optionWrapper);
		item.appendChild(button);
		wrapper.appendChild(item);
		button.addEventListener("click", () => {
			sendNavigation("nav:pluginManager");
		});
		list.insertBefore(wrapper, signOutItem);
		console.log("[Sidra] Plugin Manager menu item injected");
	}
	function observeMenu(menu) {
		if (menu.hasAttribute("data-sidra-plugin-manager-observed")) {
			injectPluginManagerItem(menu);
			return;
		}
		menu.setAttribute("data-sidra-plugin-manager-observed", "");
		injectPluginManagerItem(menu);
		new MutationObserver(() => injectPluginManagerItem(menu)).observe(menu, {
			childList: true,
			subtree: true
		});
	}
	var menu = document.querySelector(MENU_SELECTOR);
	if (menu) observeMenu(menu);
	else {
		const pageObserver = new MutationObserver(() => {
			const mountedMenu = document.querySelector(MENU_SELECTOR);
			if (!mountedMenu) return;
			pageObserver.disconnect();
			observeMenu(mountedMenu);
		});
		pageObserver.observe(document.documentElement, {
			childList: true,
			subtree: true
		});
	}
	//#endregion
})();
