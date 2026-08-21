import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.m4v', '.avi']);

function sanitizeFileName(value) {
  const cleaned = String(value || 'media').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned || 'media';
}

async function mediaFilesInDirectory(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en', { numeric: true }));
}

async function resolveLocalCopy(candidate, mediaDir, largeFileBytes) {
  if (path.resolve(path.dirname(candidate)) === path.resolve(mediaDir)) return candidate;
  const stat = await fsp.stat(candidate);
  if (stat.size <= largeFileBytes) return candidate;
  await fsp.mkdir(mediaDir, { recursive: true });
  const destination = path.join(mediaDir, sanitizeFileName(path.basename(candidate)));
  if (!fs.existsSync(destination)) await fsp.copyFile(candidate, destination);
  return destination;
}

async function existingMedia(localPath, mediaDir, largeFileBytes) {
  const candidates = String(localPath || '').split(/[;|]/).map((item) => item.trim()).filter(Boolean);
  if (!candidates.length) return [];
  const found = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) return [];
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) found.push(...await mediaFilesInDirectory(candidate));
    else if (MEDIA_EXTENSIONS.has(path.extname(candidate).toLowerCase())) found.push(candidate);
  }
  const resolved = [];
  for (const file of found) resolved.push(await resolveLocalCopy(file, mediaDir, largeFileBytes));
  return resolved;
}

function driveIdFromUrl(url) {
  const text = String(url || '');
  return text.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1]
    || text.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]
    || text.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1]
    || null;
}

async function downloadDriveFile(drive, file, destination) {
  if (fs.existsSync(destination)) return destination;
  const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
  const temporary = `${destination}.${process.pid}.part`;
  try {
    await pipeline(response.data, fs.createWriteStream(temporary, { flags: 'wx' }));
    await fsp.rename(temporary, destination);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
  return destination;
}

async function downloadFromDrive(drive, url, mediaDir, postId) {
  const id = driveIdFromUrl(url);
  if (!id) return null;
  const metadata = await drive.files.get({ fileId: id, fields: 'id,name,mimeType,fileExtension' });
  const item = metadata.data;
  if (item.mimeType === 'application/vnd.google-apps.folder') {
    const targetDir = path.join(mediaDir, `drive-folder-${id}`);
    await fsp.mkdir(targetDir, { recursive: true });
    let pageToken;
    const files = [];
    do {
      const response = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,fileExtension)',
        orderBy: 'name_natural',
        pageSize: 1000,
        pageToken
      });
      files.push(...(response.data.files || []).filter((file) => file.mimeType !== 'application/vnd.google-apps.folder'));
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    for (const file of files) {
      const destination = path.join(targetDir, sanitizeFileName(file.name || `${file.id}.${file.fileExtension || 'bin'}`));
      await downloadDriveFile(drive, file, destination);
    }
    return targetDir;
  }
  const extension = item.fileExtension ? `.${item.fileExtension}` : '';
  const target = path.join(mediaDir, sanitizeFileName(item.name || `post-${postId}${extension}`));
  await downloadDriveFile(drive, item, target);
  return target;
}

async function downloadHttp(url, mediaDir, postId) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Media download failed: HTTP ${response.status}`);
  const sourceName = path.basename(new URL(response.url).pathname) || `post-${postId}`;
  const target = path.join(mediaDir, sanitizeFileName(sourceName));
  if (!fs.existsSync(target)) {
    const temporary = `${target}.${process.pid}.part`;
    try {
      await pipeline(response.body, fs.createWriteStream(temporary, { flags: 'wx' }));
      await fsp.rename(temporary, target);
    } catch (error) {
      await fsp.unlink(temporary).catch(() => {});
      throw error;
    }
  }
  return target;
}

export async function ensureMedia({ row, drive, mediaDir, onLocalPath, largeFileBytes = 100 * 1024 * 1024 }) {
  const original = String(row['Local Media Path'] || '').trim();
  const reused = await existingMedia(original, mediaDir, largeFileBytes);
  if (reused.length) {
    const resolved = reused.join(';');
    if (resolved !== original) await onLocalPath(resolved);
    return reused;
  }
  const mediaUrl = String(row['Media URL 1'] || '').trim();
  if (!mediaUrl) return [];
  await fsp.mkdir(mediaDir, { recursive: true });
  const postId = String(row['Post ID'] || row.__rowNumber);
  const localPath = await downloadFromDrive(drive, mediaUrl, mediaDir, postId)
    || await downloadHttp(mediaUrl, mediaDir, postId);
  const files = await existingMedia(localPath, mediaDir, largeFileBytes);
  if (!files.length) throw new Error(`No supported media files were found at ${localPath}`);
  await onLocalPath(localPath);
  return files;
}
