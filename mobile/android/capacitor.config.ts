import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'world.wimpys.sidra.android',
  appName: 'Sidra',
  webDir: 'www',
  server: {
    url: 'https://music.apple.com',
    cleartext: false,
    allowNavigation: [
      'music.apple.com',
      '*.music.apple.com',
      'auth.music.apple.com',
      'idmsa.apple.com',
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
