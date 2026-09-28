import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureMedia } from '../src/media.js';

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('uses a small external file directly without copying it', async () => {
  const share = await tempDir('fb-share-');
  const mediaDir = await tempDir('fb-media-');
  const sourceFile = path.join(share, 'small.jpg');
  await fs.writeFile(sourceFile, Buffer.alloc(1024));

  const row = { __rowNumber: 2, 'Post ID': '1', 'Local Media Path': sourceFile };
  const paths = await ensureMedia({ row, mediaDir, largeFileBytes: 10 * 1024 * 1024, onLocalPath: async () => {
    assert.fail('onLocalPath should not be called when the path is unchanged');
  } });

  assert.deepEqual(paths, [sourceFile]);
  const mediaDirContents = await fs.readdir(mediaDir);
  assert.equal(mediaDirContents.length, 0, 'no file should have been copied into mediaDir');
});

test('copies a large external file into mediaDir and reports the new path', async () => {
  const share = await tempDir('fb-share-');
  const mediaDir = await tempDir('fb-media-');
  const sourceFile = path.join(share, 'large.mp4');
  await fs.writeFile(sourceFile, Buffer.alloc(2 * 1024 * 1024));

  const row = { __rowNumber: 2, 'Post ID': '1', 'Local Media Path': sourceFile };
  let reportedPath = null;
  const paths = await ensureMedia({ row, mediaDir, largeFileBytes: 1024 * 1024, onLocalPath: async (localPath) => {
    reportedPath = localPath;
  } });

  const expected = path.join(mediaDir, 'large.mp4');
  assert.deepEqual(paths, [expected]);
  assert.equal(reportedPath, expected);
  const copiedStat = await fs.stat(expected);
  assert.equal(copiedStat.size, 2 * 1024 * 1024);
});

test('does not re-copy a large file that was already resolved into mediaDir', async () => {
  const share = await tempDir('fb-share-');
  const mediaDir = await tempDir('fb-media-');
  const sourceFile = path.join(share, 'large.mp4');
  await fs.writeFile(sourceFile, Buffer.alloc(2 * 1024 * 1024));
  const alreadyLocal = path.join(mediaDir, 'large.mp4');
  await fs.writeFile(alreadyLocal, Buffer.alloc(2 * 1024 * 1024));

  const row = { __rowNumber: 2, 'Post ID': '1', 'Local Media Path': alreadyLocal };
  const paths = await ensureMedia({ row, mediaDir, largeFileBytes: 1024 * 1024, onLocalPath: async () => {
    assert.fail('onLocalPath should not be called when the file is already local');
  } });

  assert.deepEqual(paths, [alreadyLocal]);
});

test('reuses the local path for rows with a duplicate media URL', async () => {
  const mediaDir = await tempDir('fb-media-');
  const localPath = path.join(mediaDir, 'shared.jpg');
  await fs.writeFile(localPath, Buffer.alloc(1024));
  const mediaCache = new Map();
  const mediaUrl = 'https://example.test/shared.jpg';
  const firstRow = { __rowNumber: 2, 'Post ID': '1', 'Media URL 1': mediaUrl, 'Local Media Path': localPath };

  await ensureMedia({ row: firstRow, mediaDir, mediaCache, onLocalPath: async () => {
    assert.fail('onLocalPath should not be called when the path is unchanged');
  } });

  let duplicatePath = null;
  const duplicateRow = { __rowNumber: 3, 'Post ID': '2', 'Media URL 1': mediaUrl, 'Local Media Path': '' };
  const paths = await ensureMedia({ row: duplicateRow, mediaDir, mediaCache, onLocalPath: async (value) => {
    duplicatePath = value;
  } });

  assert.deepEqual(paths, [localPath]);
  assert.equal(duplicatePath, localPath);
});

test('downloads a duplicated media URL only once when rows are prefetched concurrently', async () => {
  const mediaDir = await tempDir('fb-media-');
  const mediaCache = new Map();
  const mediaUrl = 'https://example.test/shared.jpg';
  const originalFetch = globalThis.fetch;
  let downloadCount = 0;
  globalThis.fetch = async () => {
    downloadCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      ok: true,
      url: mediaUrl,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('image data'));
          controller.close();
        }
      })
    };
  };

  try {
    const rows = [2, 3].map((rowNumber) => ({
      __rowNumber: rowNumber,
      'Post ID': String(rowNumber),
      'Media URL 1': mediaUrl,
      'Local Media Path': ''
    }));
    const savedPaths = [];
    const results = await Promise.all(rows.map((row) => ensureMedia({
      row,
      mediaDir,
      mediaCache,
      onLocalPath: async (localPath) => savedPaths.push(localPath)
    })));

    assert.equal(downloadCount, 1);
    assert.equal(savedPaths.length, 2);
    assert.equal(savedPaths[0], savedPaths[1]);
    assert.deepEqual(results[0], results[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adds a supported extension when an HTTP media URL has no file extension', async () => {
  const mediaDir = await tempDir('fb-media-');
  const mediaUrl = 'https://example.test/Primo%20-%20ELECTRIC%20PASTA%20MAKER';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    url: mediaUrl,
    headers: new Headers({ 'content-type': 'video/mp4; charset=binary' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('video data'));
        controller.close();
      }
    })
  });

  try {
    const row = { __rowNumber: 26, 'Post ID': '30701', 'Media URL 1': mediaUrl, 'Local Media Path': '' };
    let reportedPath = null;
    const paths = await ensureMedia({
      row,
      mediaDir,
      onLocalPath: async (localPath) => { reportedPath = localPath; }
    });

    const expected = path.join(mediaDir, 'Primo - ELECTRIC PASTA MAKER.mp4');
    assert.deepEqual(paths, [expected]);
    assert.equal(reportedPath, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
