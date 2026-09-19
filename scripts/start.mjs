import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';

const port = 4317;

function available() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

function listenerPid() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ], { encoding: 'utf8', windowsHide: true }).trim();
      const pid = Number(out);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
    const pid = Number(out.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function commandLine(pid) {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], { encoding: 'utf8', windowsHide: true }).trim();
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

function stopPid(pid) {
  try { process.kill(pid); } catch { /* already gone */ }
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

async function waitUntilFree(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await available()) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return available();
}

if (!(await available())) {
  const pid = listenerPid();
  const cmd = pid ? commandLine(pid) : '';
  if (pid && /server\.mjs/.test(cmd) && !/node_modules/.test(cmd)) {
    console.log(`正在重启本机工作台服务（PID ${pid}）…`);
    stopPid(pid);
    if (!(await waitUntilFree())) {
      console.error(`端口 ${port} 仍被占用，无法启动。`);
      process.exit(1);
    }
  } else {
    console.error(`端口 ${port} 已被其他进程占用${pid ? `（PID ${pid}）` : ''}，请关闭后再打开 http://127.0.0.1:${port}/`);
    process.exit(1);
  }
}

const child = spawn(process.execPath, ['src/server.mjs'], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
