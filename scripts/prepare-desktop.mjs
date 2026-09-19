import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'resources');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir(path.join(root, 'src'), path.join(out, 'src'));
copyDir(path.join(root, 'public'), path.join(out, 'public')); // includes protocols.js, permission-modes.js, toast.js, chat.js, app.js
const iconsSrc = path.join(root, 'public', 'icons');
copyDir(iconsSrc, path.join(out, 'public', 'icons'));
fs.mkdirSync(path.join(out, 'node'), { recursive: true });
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
copyFile(process.execPath, path.join(out, 'node', nodeName));
if (process.platform !== 'win32') {
  try { fs.chmodSync(path.join(out, 'node', nodeName), 0o755); } catch { /* ignore */ }
}
console.log('桌面资源已准备；不包含用户数据或凭据。');
