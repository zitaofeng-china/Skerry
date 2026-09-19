import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SKIP_DIR = new Set(['node_modules', '.git', '.data', 'dist', 'build', '.next', 'coverage']);
const MAX_READ = 512 * 1024;
const MAX_GREP = 200;
const MAX_WALK = 8000;

function realExisting(target) {
  let dir = path.resolve(target);
  const parts = [];
  while (true) {
    try {
      return parts.length ? path.join(fs.realpathSync(dir), ...parts) : fs.realpathSync(dir);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return path.resolve(target);
      parts.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

export function insideWorkspace(workspace, target) {
  const root = realExisting(workspace).replace(/[\\/]+$/, '');
  const resolved = realExisting(target);
  const a = process.platform === 'win32' ? root.toLowerCase() : root;
  const b = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const sep = path.sep;
  return b === a || b.startsWith(a + sep);
}

export function resolveWorkspacePath(workspace, input, { allowOutside = false } = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少路径');
  const target = path.resolve(path.isAbsolute(raw) ? raw : path.join(workspace, raw));
  const outside = !insideWorkspace(workspace, target);
  if (outside && !allowOutside) throw new Error(`路径超出工作区：${raw}`);
  return { target, outside };
}

export function numbered(text, start = 1) {
  const lines = String(text).split(/\r?\n/);
  const width = String(start + lines.length - 1).length;
  return lines.map((line, i) => `${String(start + i).padStart(width)}|${line}`).join('\n');
}

export function readWorkspaceFile(workspace, filePath, { startLine, endLine, offset, limit, allowOutside = false } = {}) {
  const { target } = resolveWorkspacePath(workspace, filePath, { allowOutside });
  if (!fs.existsSync(target)) return { ok: false, error: `File not found: ${filePath}` };
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return { ok: false, error: `Path is a directory: ${filePath}` };
  if (stat.size > MAX_READ) return { ok: false, error: `File too large (${stat.size} bytes)` };
  const raw = fs.readFileSync(target);
  if (raw.includes(0)) return { ok: false, error: 'Binary file' };
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);
  let from = 1;
  let to = lines.length;
  if (Number.isInteger(startLine)) from = Math.max(1, startLine);
  if (Number.isInteger(endLine)) to = Math.min(lines.length, endLine);
  if (Number.isInteger(offset)) from = Math.max(1, offset);
  if (Number.isInteger(limit)) to = Math.min(lines.length, from + limit - 1);
  const slice = lines.slice(from - 1, to);
  return {
    ok: true,
    path: target,
    totalLines: lines.length,
    startLine: from,
    endLine: from + slice.length - 1,
    truncated: to < lines.length || from > 1,
    content: numbered(slice.join('\n'), from),
  };
}

export function writeWorkspaceFile(workspace, filePath, content, { overwrite = true, allowOutside = false } = {}) {
  const { target } = resolveWorkspacePath(workspace, filePath, { allowOutside });
  const exists = fs.existsSync(target);
  if (exists && overwrite === false) return { ok: false, error: `File exists: ${filePath}` };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const text = String(content ?? '');
  fs.writeFileSync(target, text, 'utf8');
  return { ok: true, path: target, created: !exists, bytes: Buffer.byteLength(text, 'utf8') };
}

export function replaceInFile(workspace, filePath, oldText, newText, { replaceAll = false, allowOutside = false } = {}) {
  const { target } = resolveWorkspacePath(workspace, filePath, { allowOutside });
  if (!fs.existsSync(target)) return { ok: false, error: `File not found: ${filePath}` };
  const current = fs.readFileSync(target, 'utf8');
  if (oldText === '') {
    if (current.length) return { ok: false, error: 'old_string is empty but file is not empty' };
    fs.writeFileSync(target, String(newText ?? ''), 'utf8');
    return { ok: true, path: target, replacements: 1 };
  }
  const count = current.split(oldText).length - 1;
  if (!count) return { ok: false, error: 'old_string not found' };
  if (!replaceAll && count > 1) return { ok: false, error: `old_string matched ${count} times; set replace_all or provide a unique block` };
  const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
  fs.writeFileSync(target, next, 'utf8');
  return { ok: true, path: target, replacements: replaceAll ? count : 1 };
}

export function listWorkspaceDir(workspace, dirPath = '.', { allowOutside = false } = {}) {
  const { target } = resolveWorkspacePath(workspace, dirPath || '.', { allowOutside });
  if (!fs.existsSync(target)) return { ok: false, error: `Directory not found: ${dirPath}` };
  if (!fs.statSync(target).isDirectory()) return { ok: false, error: `Not a directory: ${dirPath}` };
  const entries = fs.readdirSync(target, { withFileTypes: true }).map(entry => {
    let size = null;
    try { if (entry.isFile()) size = fs.statSync(path.join(target, entry.name)).size; } catch { /* ignore */ }
    return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size };
  });
  return { ok: true, path: target, entries };
}

export function previewWorkspaceFile(workspace, filePath, { allowOutside = false, maxBytes = MAX_READ } = {}) {
  const { target } = resolveWorkspacePath(workspace, filePath, { allowOutside });
  if (!fs.existsSync(target)) return { ok: false, error: `File not found: ${filePath}` };
  const stat = fs.statSync(target);
  const relative = (path.relative(workspace, target) || path.basename(target)).replace(/\\/g, '/');
  const name = path.basename(target);
  if (stat.isDirectory()) {
    const listed = listWorkspaceDir(workspace, target, { allowOutside });
    return {
      ok: true,
      kind: 'directory',
      path: target,
      relative,
      name,
      entries: listed.entries || [],
    };
  }
  if (stat.size > maxBytes) {
    return { ok: false, kind: 'too_large', error: `File too large (${stat.size} bytes)`, path: target, relative, name };
  }
  const raw = fs.readFileSync(target);
  if (raw.includes(0)) {
    return { ok: false, kind: 'binary', error: 'Binary file', path: target, relative, name };
  }
  const text = raw.toString('utf8');
  return {
    ok: true,
    kind: 'file',
    path: target,
    relative,
    name,
    content: text,
    totalLines: text.split(/\r?\n/).length,
    bytes: stat.size,
  };
}

function globToRegExp(pattern) {
  const src = String(pattern || '').replace(/\\/g, '/');
  let out = '^';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '*' && src[i + 1] === '*') {
      out += src[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += src[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if ('\\^$+()[]{}|.'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(out + '$', 'i');
}

export function walkFiles(root, { max = MAX_WALK } = {}) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < max) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (SKIP_DIR.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
      if (files.length >= max) break;
    }
  }
  return files;
}

export function findByGlob(workspace, pattern, { directory, allowOutside = false } = {}) {
  const base = resolveWorkspacePath(workspace, directory || '.', { allowOutside }).target;
  if (!fs.existsSync(base)) return { ok: false, error: `Directory not found: ${directory || '.'}` };
  const rx = globToRegExp(pattern);
  const matches = walkFiles(base).filter(file => rx.test(file.replace(/\\/g, '/')) || rx.test(path.relative(base, file).replace(/\\/g, '/')));
  return { ok: true, matches: matches.slice(0, 200), truncated: matches.length > 200 };
}

export function grepSearch(workspace, pattern, { searchPath, glob, regex = true, headLimit = MAX_GREP, allowOutside = false } = {}) {
  const base = resolveWorkspacePath(workspace, searchPath || '.', { allowOutside }).target;
  let rx;
  try { rx = regex ? new RegExp(pattern, 'i') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  catch (error) { return { ok: false, error: `Invalid pattern: ${error.message}` }; }
  const globRx = glob ? globToRegExp(glob) : null;
  const files = fs.existsSync(base) && fs.statSync(base).isFile()
    ? [base]
    : walkFiles(base).filter(file => !globRx || globRx.test(file.replace(/\\/g, '/')) || globRx.test(path.basename(file)));
  const hits = [];
  for (const file of files) {
    let text = '';
    try {
      const buf = fs.readFileSync(file);
      if (buf.includes(0) || buf.length > MAX_READ) continue;
      text = buf.toString('utf8');
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!rx.test(lines[i])) continue;
      hits.push({ path: file, line: i + 1, text: lines[i].slice(0, 400) });
      if (hits.length >= headLimit) return { ok: true, matches: hits, truncated: true };
    }
  }
  return { ok: true, matches: hits, truncated: false };
}

export function formatToolResult(result) {
  if (result == null) return 'ok';
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

const running = new Map();

function taskView(task) {
  return {
    id: task.id,
    command: task.command,
    cwd: task.cwd,
    workspace: task.workspace,
    running: task.running,
    exitCode: task.exitCode,
    output: task.output.slice(-8000),
  };
}

export function listBackgroundTasks(workspace) {
  const all = [...running.values()];
  const filtered = workspace ? all.filter(task => task.workspace === workspace) : all;
  return filtered.map(taskView);
}

export function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, 1500).unref?.();
}

export function killBackgroundTask(id) {
  const task = running.get(id);
  if (!task) return { ok: false, error: `Unknown task: ${id}` };
  killProcessTree(task.child);
  task.running = false;
  return { ok: true, id };
}

export function abortWorkspaceCommands(workspace) {
  let n = 0;
  for (const task of running.values()) {
    if (workspace && task.workspace !== workspace) continue;
    if (!task.running) continue;
    killProcessTree(task.child);
    task.running = false;
    n += 1;
  }
  return n;
}

export function writeTaskStdin(id, text) {
  const task = running.get(id);
  if (!task?.running) return { ok: false, error: `Task not running: ${id}` };
  task.child.stdin.write(String(text ?? ''));
  return { ok: true, id };
}

function spawnShell(line, workdir) {
  if (process.platform === 'win32') {
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], {
      cwd: workdir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  const shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return spawn(shell, ['-lc', line], {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' },
  });
}

export function runWorkspaceCommand(workspace, command, {
  cwd,
  timeoutMs = 30000,
  background = false,
  waitMsBeforeAsync = 0,
  allowOutside = false,
  abortSignal,
} = {}) {
  const line = String(command || '').trim();
  if (!line) return Promise.resolve({ ok: false, error: 'Missing command' });
  const workdir = resolveWorkspacePath(workspace, cwd || '.', { allowOutside }).target;
  const id = crypto.randomUUID();
  const child = spawnShell(line, workdir);
  const task = { id, command: line, cwd: workdir, workspace, child, running: true, exitCode: null, output: '' };
  running.set(id, task);
  child.stdout.on('data', chunk => { task.output += chunk.toString('utf8'); if (task.output.length > 200000) task.output = task.output.slice(-150000); });
  child.stderr.on('data', chunk => { task.output += chunk.toString('utf8'); if (task.output.length > 200000) task.output = task.output.slice(-150000); });
  const onAbort = () => {
    if (task.running) killProcessTree(child);
  };
  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    else abortSignal.addEventListener('abort', onAbort, { once: true });
  }
  const done = new Promise(resolve => {
    child.on('close', code => {
      task.running = false;
      task.exitCode = code;
      abortSignal?.removeEventListener?.('abort', onAbort);
      resolve({ ok: code === 0, id, command: line, cwd: workdir, exitCode: code, output: task.output.slice(-12000), background: false });
    });
    child.on('error', error => {
      task.running = false;
      abortSignal?.removeEventListener?.('abort', onAbort);
      resolve({ ok: false, id, command: line, error: error.message, output: task.output, background: false });
    });
  });
  if (timeoutMs > 0) {
    const timer = setTimeout(() => {
      if (task.running) killProcessTree(child);
    }, timeoutMs);
    done.finally(() => clearTimeout(timer));
  }
  if (background) {
    return Promise.resolve({ ok: true, id, command: line, cwd: workdir, background: true, message: 'Started in background' });
  }
  if (waitMsBeforeAsync > 0) {
    return Promise.race([
      done,
      new Promise(resolve => setTimeout(() => {
        if (task.running) resolve({ ok: true, id, command: line, cwd: workdir, background: true, output: task.output.slice(-4000), message: 'Still running; use manage_task / write_stdin' });
      }, waitMsBeforeAsync)),
    ]);
  }
  return done;
}

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.', '0.0.0.0', '::1', '::ffff:127.0.0.1',
]);

function hostBlocked(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === 'metadata.google.internal' || host.endsWith('.internal')) return true;
  return false;
}

export async function fetchUrlText(url) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only http(s) URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('URL credentials are not allowed');
  if (hostBlocked(parsed.hostname)) throw new Error('That host is not allowed');
  const response = await fetch(parsed.href, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Skerry/0.1' } });
  const text = await response.text();
  const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { ok: response.ok, status: response.status, url: parsed.href, text: stripped.slice(0, 20000) };
}

export function fileKindIcon(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) return 'image';
  if (['.md', '.markdown', '.txt', '.rst'].includes(ext)) return 'text';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.cs', '.rb', '.php', '.sh', '.zsh', '.ps1'].includes(ext)) return 'code';
  if (['.json', '.yml', '.yaml', '.toml', '.xml', '.csv'].includes(ext)) return 'data';
  if (['.html', '.css', '.scss'].includes(ext)) return 'web';
  if (['.pdf'].includes(ext)) return 'pdf';
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) return 'office';
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) return 'archive';
  return 'file';
}
