import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, defaultWorkspaceRoot, publicDirSafe, workspaceRoot, writeConfig } from './paths.mjs';

test('默认配置在 ~/.skerry，工作区母目录在 Downloads/Skerry工作区', () => {
  const env = { HOME: '/Users/demo' };
  assert.equal(dataDir(env), path.join('/Users/demo', '.skerry'));
  assert.equal(defaultWorkspaceRoot(env), path.join('/Users/demo', 'Downloads', 'Skerry工作区'));
  assert.equal(workspaceRoot(env), defaultWorkspaceRoot(env));
});

test('AGENTS_DATA_DIR 覆盖配置目录，可单独改工作区母目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-paths-'));
  const env = { HOME: '/Users/demo', AGENTS_DATA_DIR: dir };
  try {
    assert.equal(dataDir(env), path.resolve(dir));
    writeConfig({ workspaceRoot: path.join(dir, 'projects') }, env);
    assert.equal(workspaceRoot(env), path.resolve(dir, 'projects'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('静态文件路径不能逃出 public', () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.ok(publicDirSafe(root, '/index.html').endsWith(`${path.sep}public${path.sep}index.html`));
  assert.equal(publicDirSafe(root, '/../package.json'), null);
  assert.equal(publicDirSafe(root, '/foo/../../package.json'), null);
});
