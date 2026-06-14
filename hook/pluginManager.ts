// Source for assets/pluginManager.js — do not edit the built file directly.
const ITEM_ID = 'sidra-plugin-manager-menu-item';
const MENU_SELECTOR = 'amp-contextual-menu';
const LIST_SELECTOR = 'ul.contextual-menu__list[role="menu"]';
const OPTION_TEXT_SELECTOR = '.contextual-menu-item__option-text';

declare global {
  interface Window {
    AMWrapper?: {
      ipcRenderer: {
        send(channel: string): void;
      };
    };
    SidraAndroid?: {
      postMessage(message: string): void;
    };
  }
}

function sendNavigation(channel: string): void {
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

function injectPluginManagerItem(menu: Element): void {
  if (document.getElementById(ITEM_ID)) return;

  const list = menu.querySelector(LIST_SELECTOR);
  if (!list) return;

  const signOutText = Array.from(list.querySelectorAll(OPTION_TEXT_SELECTOR))
    .find(element => element.textContent?.trim() === 'Sign Out');
  const signOutItem = signOutText?.closest('amp-contextual-menu-item');
  if (!signOutItem) return;

  const wrapper = document.createElement('amp-contextual-menu-item');
  wrapper.id = ITEM_ID;
  wrapper.setAttribute('hydrated', '');

  const item = document.createElement('li');
  item.className = 'contextual-menu-item';

  const button = document.createElement('button');
  button.type = 'button';

  const optionWrapper = document.createElement('span');
  optionWrapper.className = 'contextual-menu-item__option-wrapper';

  const optionText = document.createElement('span');
  optionText.className = 'contextual-menu-item__option-text';
  optionText.textContent = 'Plugin Manager';

  optionWrapper.appendChild(optionText);
  button.appendChild(optionWrapper);
  item.appendChild(button);
  wrapper.appendChild(item);

  button.addEventListener('click', () => {
    sendNavigation('nav:pluginManager');
  });

  list.insertBefore(wrapper, signOutItem);
  console.log('[Sidra] Plugin Manager menu item injected');
}

function observeMenu(menu: Element): void {
  if (menu.hasAttribute('data-sidra-plugin-manager-observed')) {
    injectPluginManagerItem(menu);
    return;
  }

  menu.setAttribute('data-sidra-plugin-manager-observed', '');
  injectPluginManagerItem(menu);

  new MutationObserver(() => injectPluginManagerItem(menu)).observe(menu, {
    childList: true,
    subtree: true,
  });
}

function startPageObserver(): void {
  const pageObserver = new MutationObserver(() => {
    const mountedMenu = document.querySelector(MENU_SELECTOR);
    if (!mountedMenu) return;
    observeMenu(mountedMenu);
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
}

const menu = document.querySelector(MENU_SELECTOR);
if (menu) {
  observeMenu(menu);
}
startPageObserver();
