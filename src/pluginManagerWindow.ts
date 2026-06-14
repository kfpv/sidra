import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getTheme, getZoomFactor } from './config';
import { getAssetPath } from './paths';

const PLUGIN_MANAGER_WIDTH_PX = 900;
const PLUGIN_MANAGER_HEIGHT_PX = 650;
const pluginManagerLog = log.scope('pluginManager');

let pluginManagerWindow: BrowserWindow | null = null;

export function showPluginManagerWindow(): void {
  if (pluginManagerWindow) {
    pluginManagerWindow.focus();
    return;
  }

  const zoomFactor = getZoomFactor();
  pluginManagerWindow = new BrowserWindow({
    title: 'Plugin Manager',
    width: Math.round(PLUGIN_MANAGER_WIDTH_PX * zoomFactor),
    height: Math.round(PLUGIN_MANAGER_HEIGHT_PX * zoomFactor),
    minWidth: 600,
    minHeight: 400,
    center: true,
    show: false,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  pluginManagerWindow.once('ready-to-show', () => {
    pluginManagerWindow?.webContents.setZoomFactor(getZoomFactor());
    pluginManagerWindow?.show();
  });
  pluginManagerWindow.on('closed', () => {
    pluginManagerWindow = null;
  });

  pluginManagerLog.info('showing Plugin Manager window');
  pluginManagerWindow.loadFile(
    getAssetPath('assets', 'plugin-manager', 'index.html'),
    { query: { theme: getTheme() } },
  );
}
