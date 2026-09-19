import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'Skerry';
export const KEYCHAIN_SERVICE = 'Skerry';

export function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

export function dataDir(env = process.env) {
  if (env.AGENTS_DATA_DIR) return path.resolve(env.AGENTS_DATA_DIR);
  return path.join(homeDir(env), '.skerry');
}

export function configPath(env = process.env) {
  return path.join(dataDir(env), 'config.json');
}

export function workspaceStatePath(env = process.env) {
  return path.join(dataDir(env), 'workspace.json');
}

export function defaultWorkspaceRoot(env = process.env) {
  return path.join(homeDir(env), 'Downloads', 'Skerry工作区');
}

export function readConfig(env = process.env) {
  const file = configPath(env);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfig(patch, env = process.env) {
  const dir = dataDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...readConfig(env), ...patch };
  const file = configPath(env);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

export function workspaceRoot(env = process.env) {
  const configured = String(readConfig(env).workspaceRoot || '').trim();
  if (configured) return path.resolve(configured);
  return defaultWorkspaceRoot(env);
}

export function ensureWorkspaceRoot(env = process.env) {
  const root = workspaceRoot(env);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function publicDirSafe(root, reqPath) {
  const publicDir = path.resolve(root, 'public');
  const reqFile = reqPath === '/' ? 'index.html' : String(reqPath || '').replace(/^\/+/, '');
  const localFile = path.resolve(publicDir, reqFile);
  const rel = path.relative(publicDir, localFile);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return localFile;
}
