import { dialog, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log/main';

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

function getFileNameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
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
      const name = getFileNameWithoutExt(filePath);
      files.push({
        id: generateId(),
        name,
        artist: 'Local File',
        album: 'Local Files',
        duration: 0,
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
}
