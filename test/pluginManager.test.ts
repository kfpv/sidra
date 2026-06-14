import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'pluginManager.js'),
  'utf-8',
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
) as { build: { asarUnpack: string[] } };

describe('Plugin Manager menu injection', () => {
  it('targets the account menu and waits for its lazy list', () => {
    expect(script).toContain('amp-contextual-menu');
    expect(script).toContain('ul.contextual-menu__list[role=\\"menu\\"]');
    expect(script).toContain('MutationObserver');
  });

  it('creates a hydrated Apple menu item before Sign Out', () => {
    expect(script).toContain('amp-contextual-menu-item');
    expect(script).toContain('hydrated');
    expect(script).toContain('Sign Out');
    expect(script).toContain('insertBefore');
  });

  it('sends the typed Plugin Manager navigation channel', () => {
    expect(script).toContain('nav:pluginManager');
    expect(script).toContain('AMWrapper.ipcRenderer.send');
    expect(script).toContain('SidraAndroid.postMessage');
  });

  it('is unpacked for runtime loading', () => {
    expect(packageJson.build.asarUnpack).toContain('assets/pluginManager.js');
  });
});
