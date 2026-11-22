import log from 'electron-log/main';
import type { ThemeName } from './theme';

const configLog = log.scope('config');

interface StoreSchema {
  storefront: string;
  language: string | null;
  'notifications.enabled': boolean;
  'discord.enabled': boolean;
  theme: ThemeName;
  'autoUpdate.enabled': boolean;
  startPage: 'home' | 'new' | 'radio' | 'all-playlists' | 'last';
  lastPageUrl: string;
  zoomFactor: number;
  'localPlaylists.favourites': string[];
  'localPlaylists.custom': Record<string, string[]>;
}

import { Conf } from 'electron-conf/main';

const store = new Conf<StoreSchema>();

function getConfigValue<K extends keyof StoreSchema>(key: K, defaultValue: StoreSchema[K]): StoreSchema[K] {
  if (!store.has(key)) return defaultValue;
  return store.get(key);
}

function getConfigValueOptional<K extends keyof StoreSchema>(key: K): StoreSchema[K] | undefined {
  if (!store.has(key)) return undefined;
  return store.get(key);
}

export function getStorefront(): string | undefined {
  return getConfigValueOptional('storefront');
}

export function setStorefront(code: string): void {
  store.set('storefront', code);
  configLog.info('storefront set:', code);
}

export function getLanguage(): string | null | undefined {
  return getConfigValueOptional('language');
}

export function setLanguage(lang: string | null): void {
  store.set('language', lang);
  configLog.info('language set:', lang);
}

export function getNotificationsEnabled(): boolean {
  return getConfigValue('notifications.enabled', true);
}

export function setNotificationsEnabled(enabled: boolean): void {
  store.set('notifications.enabled', enabled);
  configLog.info('notifications.enabled set:', enabled);
}

export function getDiscordEnabled(): boolean {
  return getConfigValue('discord.enabled', false);
}

export function setDiscordEnabled(enabled: boolean): void {
  store.set('discord.enabled', enabled);
  configLog.info('discord.enabled set:', enabled);
}

export function getTheme(): ThemeName {
  return getConfigValue('theme', 'apple-music');
}

export function setTheme(name: ThemeName): void {
  store.set('theme', name);
  configLog.info('theme set:', name);
}

export function getAutoUpdateEnabled(): boolean {
  return getConfigValue('autoUpdate.enabled', true);
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  store.set('autoUpdate.enabled', enabled);
  configLog.info('autoUpdate.enabled set:', enabled);
}

export function getLastPageUrl(): string | undefined {
  return getConfigValueOptional('lastPageUrl');
}

export function setLastPageUrl(url: string): void {
  store.set('lastPageUrl', url);
  configLog.info('lastPageUrl set:', url);
}

export function getStartPage(): 'home' | 'new' | 'radio' | 'all-playlists' | 'last' {
  return getConfigValue('startPage', 'new');
}

export function setStartPage(page: 'home' | 'new' | 'radio' | 'all-playlists' | 'last'): void {
  store.set('startPage', page);
  configLog.info('startPage set:', page);
}

export function getZoomFactor(): number {
  return getConfigValue('zoomFactor', 1.0);
}

export function setZoomFactor(factor: number): void {
  store.set('zoomFactor', factor);
  configLog.info('zoomFactor set:', factor);
}

// --- Local playlists ---

export function getFavourites(): string[] {
  return getConfigValue('localPlaylists.favourites', []);
}

export function addFavourite(id: string): void {
  const current = getFavourites();
  if (!current.includes(id)) {
    store.set('localPlaylists.favourites', [...current, id]);
    configLog.info('favourite added:', id);
  }
}

export function removeFavourite(id: string): void {
  const current = getFavourites();
  store.set('localPlaylists.favourites', current.filter(f => f !== id));
  configLog.info('favourite removed:', id);
}

export function isFavourite(id: string): boolean {
  return getFavourites().includes(id);
}

export function getCustomPlaylists(): Record<string, string[]> {
  return getConfigValue('localPlaylists.custom', {});
}

export function createLocalPlaylist(name: string): void {
  const playlists = getCustomPlaylists();
  if (!playlists[name]) {
    playlists[name] = [];
    store.set('localPlaylists.custom', playlists);
    configLog.info('local playlist created:', name);
  }
}

export function addToLocalPlaylist(playlistName: string, id: string): void {
  const playlists = getCustomPlaylists();
  if (!playlists[playlistName]) playlists[playlistName] = [];
  if (!playlists[playlistName].includes(id)) {
    playlists[playlistName].push(id);
    store.set('localPlaylists.custom', playlists);
    configLog.info('added to playlist:', playlistName, id);
  }
}

export function removeFromLocalPlaylist(playlistName: string, id: string): void {
  const playlists = getCustomPlaylists();
  if (playlists[playlistName]) {
    playlists[playlistName] = playlists[playlistName].filter(i => i !== id);
    store.set('localPlaylists.custom', playlists);
    configLog.info('removed from playlist:', playlistName, id);
  }
}

