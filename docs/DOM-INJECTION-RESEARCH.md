# Apple Music DOM Injection Research

This note records the non-obvious details needed to reproduce reliable element
injection into Apple Music's web UI. The working example is
`assets/pluginManager.js`.

## Account menu lifecycle

- `amp-contextual-menu` exists before the account menu is opened.
- Its `ul.contextual-menu__list[role="menu"]` is created lazily on the first
  open and then retained while visibility is toggled.
- Run an immediate injection attempt, then observe the menu host with a
  subtree `MutationObserver`. A page-level observer is only needed as a
  fallback until the host itself appears.
- Make injection idempotent with a stable element ID. Re-running the script on
  SPA navigation must not add duplicates.

Do not make injection depend on MusicKit becoming available. Menu injection has
its own DOM lifecycle, so a separate hook is clearer and can initialise earlier
than `musicKitHook.js`.

## Matching Apple's structure

Create the same hierarchy Apple uses:

```text
amp-contextual-menu-item[hydrated]
  li.contextual-menu-item
    button
      span.contextual-menu-item__option-wrapper
        span.contextual-menu-item__option-text
```

The `hydrated` attribute is required. Without it, the custom element may remain
hidden or render without usable text.

Locate the target position by finding the option-text element whose trimmed
text is `Sign Out`, then call `closest('amp-contextual-menu-item')` and
`list.insertBefore(newItem, signOutItem)`. This is more reliable than assuming a
fixed child index.

## DOM assumptions corrected during testing

The `My Account` trigger is not an ancestor or descendant of the rendered
`amp-contextual-menu`. Apple renders the menu elsewhere in the document, so
`accountButton.closest('amp-contextual-menu')` returns `null`. Treat the menu as
portal-style UI and locate its host/list independently.

Also, clicking the account trigger is not itself sufficient evidence that the
hook worked. Inspect the resulting list and verify:

- exactly one injected ID exists;
- the wrapper is hydrated and visible;
- the complete nested structure is present;
- the injected item is the direct previous sibling of `Sign Out`.

## IPC and packaging

Page-world click handlers can call:

```js
window.AMWrapper.ipcRenderer.send('nav:pluginManager');
```

The channel must also be added to both `SendChannel` and the preload
`SEND_CHANNELS` allowlist. The script must be loaded by `main.ts`, injected on
full loads and SPA navigations, and listed individually in `asarUnpack`.

## Reliable live verification

After changing a runtime-loaded asset, rebuild and launch a fresh Electron
process with a known free debugging port. Confirm `/json/list` points to the
new process before attaching. A stale process or occupied port can otherwise
make an old renderer look like a failed injection.

Open the account menu in that fresh renderer and inspect the actual page world.
For the successful implementation, live testing confirmed one visible,
hydrated item immediately before `Sign Out`, plus a click listener whose source
sends `nav:pluginManager`.
