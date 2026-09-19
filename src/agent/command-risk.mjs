const TOKEN_BOUNDARIES = new Set([' ', '\t', '\r', '\n']);
const SHELL_OPERATORS = new Set([';', '|', '&', '>', '<', '(', ')']);
const COMMAND_SEPARATORS = new Set([';', '|', '||', '&', '&&', '(', ')']);
const COMMAND_WRAPPERS = new Set(['env', 'command', 'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'wsl']);

function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  let escaped = false;
  const push = () => {
    if (!current) return;
    tokens.push(current);
    current = '';
  };
  const input = String(command || '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      else if (ch === '\\') escaped = true;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (TOKEN_BOUNDARIES.has(ch)) {
      push();
      if (ch === '\n' || ch === '\r') tokens.push(';');
      continue;
    }
    if (SHELL_OPERATORS.has(ch)) {
      push();
      const pair = ch === '|' || ch === '&' || ch === '>' || ch === '<';
      if (pair && input[i + 1] === ch) {
        tokens.push(ch + ch);
        i += 1;
      } else tokens.push(ch);
      continue;
    }
    current += ch;
  }
  push();
  return tokens;
}

function norm(token) {
  return String(token || '').trim().toLowerCase();
}

function baseName(token) {
  const value = norm(token);
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  let name = slash >= 0 ? value.slice(slash + 1) : value;
  for (const suffix of ['.exe', '.cmd', '.bat', '.ps1']) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name;
}

function unwrap(tokens) {
  const expanded = [...tokens];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = norm(tokens[i]);
    if (token !== '-c' && token !== '/c' && token !== '-command' && token !== '-lc') continue;
    let start = i - 1;
    while (start > 0 && !COMMAND_SEPARATORS.has(norm(tokens[start - 1]))) start -= 1;
    if (!COMMAND_WRAPPERS.has(baseName(tokens[start]))) continue;
    let end = i + 1;
    while (end < tokens.length && !COMMAND_SEPARATORS.has(norm(tokens[end]))) end += 1;
    const nested = tokenize(tokens.slice(i + 1, end).join(' '));
    if (nested.length) expanded.push(';', ...nested);
  }
  return expanded;
}

function entriesOf(tokens) {
  const entries = [];
  let expect = true;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = norm(tokens[i]);
    if (!token) continue;
    if (COMMAND_SEPARATORS.has(token)) {
      expect = true;
      continue;
    }
    if (!expect) continue;
    const name = baseName(tokens[i]);
    if (!name) continue;
    entries.push({ name, index: i });
    if (name === 'sudo' || name === 'doas' || name === 'command' || name === 'env' || name === 'wsl') {
      expect = true;
      continue;
    }
    expect = false;
  }
  return entries;
}

function argsOf(tokens, index) {
  const args = [];
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = norm(tokens[i]);
    if (COMMAND_SEPARATORS.has(token)) break;
    if (token) args.push(token);
  }
  return args;
}

function hasAny(values, expected) {
  return values.some(value => expected.has(value));
}

function high(category, reason) {
  return { level: 'high', needsConfirm: true, category, reason };
}

function normal() {
  return { level: 'normal', needsConfirm: false, category: 'normal', reason: '' };
}

/** Inspect a shell line. High-risk commands must be confirmed unless the session is fully authorized. */
export function inspectCommand(command) {
  const initial = tokenize(command);
  if (!initial.length) return high('invalid', '命令为空或无法解析');
  const tokens = unwrap(initial);
  const entries = entriesOf(tokens);
  const names = new Set(entries.map(entry => entry.name));

  if (names.has('sudo') || names.has('doas') || names.has('runas')) {
    return high('elevation', '命令请求提升系统权限');
  }

  const deletes = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'remove-itemproperty', 'unlink']);
  if (hasAny([...names], deletes)) return high('file_delete', '命令会删除文件或目录');

  const system = new Set([
    'format', 'diskpart', 'dd', 'clear-disk', 'initialize-disk', 'format-volume',
    'shutdown', 'reboot', 'restart-computer', 'stop-computer', 'halt', 'poweroff',
    'set-executionpolicy', 'bcdedit', 'cipher', 'reg', 'sc', 'launchctl', 'diskutil',
    'csrutil', 'nvram', 'bless', 'kmutil',
  ]);
  for (const entry of entries) {
    if (entry.name.startsWith('mkfs')) return high('disk', '命令会修改磁盘或文件系统');
    if (!system.has(entry.name)) continue;
    const args = argsOf(tokens, entry.index);
    if (entry.name === 'reg' && args[0] !== 'delete') continue;
    if (entry.name === 'sc' && args[0] !== 'delete' && args[0] !== 'stop') continue;
    if (entry.name === 'launchctl' && args[0] !== 'unload' && args[0] !== 'bootout' && args[0] !== 'disable') continue;
    if (entry.name === 'diskutil' && !['eraseDisk', 'eraseVolume', 'partitionDisk', 'resetFusion'].includes(args[0])) continue;
    return high('system', '命令会修改磁盘、系统配置或电源状态');
  }

  for (const entry of entries) {
    const args = argsOf(tokens, entry.index);
    if (entry.name === 'git') {
      const op = args[0] || '';
      if (op === 'reset' && args.includes('--hard')) return high('git_destructive', '命令会丢弃本地 Git 修改');
      if (op === 'clean' && args.some(arg => arg.startsWith('-') && arg.includes('f'))) return high('git_destructive', '命令会永久删除未跟踪文件');
      if (op === 'push' && hasAny(args, new Set(['-f', '--force', '--force-with-lease']))) return high('git_remote', '命令会强制改写远程 Git 历史');
      if (op === 'restore' && !args.includes('--staged')) return high('git_destructive', '命令可能丢弃本地文件修改');
      if (op === 'branch' && hasAny(args, new Set(['-d', '--delete', '-D']))) return high('git_destructive', '命令会删除 Git 分支');
      if (op === 'checkout' && (args.includes('--') || args.includes('-f') || args.includes('--force'))) {
        return high('git_destructive', '命令会丢弃本地文件修改');
      }
      if (op === 'stash' && hasAny(args, new Set(['drop', 'clear']))) return high('git_destructive', '命令会永久丢弃暂存修改');
      if (op === 'worktree' && args[1] === 'remove' && hasAny(args, new Set(['-f', '--force']))) {
        return high('git_destructive', '命令会强制删除工作树');
      }
      if (op === 'filter-branch' || op === 'filter-repo') return high('git_destructive', '命令会改写全部 Git 历史');
    }
    if (entry.name === 'docker') {
      const op = args[0] || '';
      if (op === 'system' && args[1] === 'prune') return high('container_delete', '命令会批量删除容器资源');
      if (op === 'volume' && (args[1] === 'rm' || args[1] === 'prune')) return high('container_delete', '命令会删除容器数据卷');
    }
    if (entry.name === 'kubectl' && args[0] === 'delete') return high('cluster_delete', '命令会删除集群资源');
    if (entry.name === 'terraform' && args[0] === 'destroy') return high('infrastructure_delete', '命令会销毁基础设施');
    if (entry.name === 'start-process' && args.includes('-verb') && args.includes('runas')) {
      return high('elevation', '命令请求提升系统权限');
    }
  }

  const downloaders = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest', 'fetch']);
  const interpreters = new Set(['sh', 'bash', 'zsh', 'powershell', 'pwsh', 'iex', 'invoke-expression', 'python', 'python3', 'node', 'perl', 'ruby']);
  const piped = tokens.some(token => token === '|');
  if (piped && hasAny([...names], downloaders) && hasAny([...names], interpreters)) {
    return high('remote_execution', '命令会下载远程内容并直接执行');
  }
  if (names.has('invoke-expression') || names.has('iex')) {
    return high('dynamic_execution', '命令会动态执行生成的代码');
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] !== '>' && tokens[i] !== '>>') continue;
    const target = norm(tokens[i + 1]);
    if (target.startsWith('/dev/sd') || target.startsWith('/dev/disk') || target.startsWith('\\\\.\\physicaldrive')) {
      return high('disk', '命令会直接写入磁盘设备');
    }
  }

  return normal();
}

export function commandLineOf(args = {}) {
  return String(args.command || args.cmd || args.CommandLine || args.script || '').trim();
}
