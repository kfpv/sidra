import { dialog, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log/main';
import { parseBuffer } from 'music-metadata';
import { addFavourite, removeFavourite, isFavourite, createLocalPlaylist, addToLocalPlaylist, removeFromLocalPlaylist, getCustomPlaylists } from './config';

const mainLog = log.scope('localFiles');

export interface LocalFile {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  dataBase64: string;
  mimeType: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.wma', '.opus',
]);

function generateId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.wma': 'audio/x-ms-wma',
    '.opus': 'audio/opus',
  };
  return map[ext] || 'audio/octet-stream';
}

async function getAudioDuration(filePath: string, buffer: Buffer): Promise<number> {
  try {
    const metadata = await parseBuffer(new Uint8Array(buffer), undefined, { duration: true });
    return metadata.format.duration ?? 0;
  } catch (err) {
    mainLog.warn(`Failed to parse audio metadata: ${filePath}`, err);
    return 0;
  }
}

function getFileNameWithoutExt(filePath: string): string {
  let base = path.basename(filePath);
  // Strip all extensions (handles .mp4a.m4a, .flac.flac, etc.)
  while (base.includes('.')) {
    base = path.basename(base, path.extname(base));
  }
  return base;
}

function parseArtistTitle(filename: string): { artist: string; title: string } {
  // "Artist - Title" → split on first " - "
  const dashIdx = filename.indexOf(' - ');
  if (dashIdx === -1) {
    return { artist: 'Unknown Artist', title: filename };
  }
  return {
    artist: filename.slice(0, dashIdx).trim(),
    title: filename.slice(dashIdx + 3).trim(),
  };
}

async function selectFiles(win: BrowserWindow): Promise<LocalFile[]> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Add Local Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac', 'wma', 'opus'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const files: LocalFile[] = [];
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      mainLog.warn(`Skipping unsupported file: ${filePath}`);
      continue;
    }

    try {
      const data = fs.readFileSync(filePath);
      const rawName = getFileNameWithoutExt(filePath);
      const { artist, title } = parseArtistTitle(rawName);
      const duration = await getAudioDuration(filePath, data);
      files.push({
        id: generateId(),
        name: title,
        artist,
        album: 'Local Files',
        duration,
        dataBase64: data.toString('base64'),
        mimeType: getMimeType(ext),
      });
    } catch (err) {
      mainLog.warn(`Failed to read file: ${filePath}`, err);
    }
  }

  mainLog.info(`Selected ${files.length} local files`);
  return files;
}

export function initLocalFiles(win: BrowserWindow): void {
  ipcMain.on('localFiles:select', async () => {
    const files = await selectFiles(win);
    if (files.length > 0) {
      win.webContents.send('localFiles:data', files);
    }
  });

  ipcMain.on('localFiles:favourite', (_event, id: string) => {
    addFavourite(id);
    mainLog.info('favourited:', id);
  });

  ipcMain.on('localFiles:unfavourite', (_event, id: string) => {
    removeFavourite(id);
    mainLog.info('unfavourited:', id);
  });

  ipcMain.on('localFiles:isFavourite', (_event, id: string) => {
    win.webContents.send('localFiles:favouriteResult', { id, isFavourite: isFavourite(id) });
  });

  ipcMain.on('localFiles:createPlaylist', (_event, name: string) => {
    createLocalPlaylist(name);
  });

  ipcMain.on('localFiles:addToPlaylist', (_event, playlistName: string, id: string) => {
    addToLocalPlaylist(playlistName, id);
  });

  ipcMain.on('localFiles:removeFromPlaylist', (_event, playlistName: string, id: string) => {
    removeFromLocalPlaylist(playlistName, id);
  });

  ipcMain.on('localFiles:getPlaylists', () => {
    win.webContents.send('localFiles:playlistsResult', getCustomPlaylists());
  });
}
