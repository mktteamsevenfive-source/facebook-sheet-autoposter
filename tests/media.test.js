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
