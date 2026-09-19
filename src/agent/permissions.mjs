import {
  DEFAULT_MODE,
  VENDOR_MODES,
  cycleMode,
  describeMode,
  modeMenuTitle,
  modeOptions,
  normalizeMode,
} from '../../public/permission-modes.js';
import { inspectCommand, commandLineOf } from './command-risk.mjs';

export {
  DEFAULT_MODE,
  VENDOR_MODES,
  cycleMode,
  describeMode,
  modeMenuTitle,
  modeOptions,
  normalizeMode,
};

const READ = 'read';
const WRITE = 'write';
const EXEC = 'exec';
const NET = 'net';
const ASK = 'ask';
const NONE = 'none';

export function classifyRisk(kind, commandRisk) {
  if (commandRisk?.level === 'high') return 'high';
  return kind === READ || kind === NONE ? 'low' : kind === WRITE || kind === ASK ? 'medium' : 'high';
}

export function isFullAccess(vendor, mode) {
  const m = normalizeMode(vendor, mode);
  return m === 'never' || m === 'bypassPermissions';
}

/**
 * @returns {{ action: 'allow'|'ask'|'deny', reason?: string, commandRisk?: object }}
 */
export function decidePermission({
  vendor,
  mode,
  kind,
  outsideWorkspace = false,
  planLocked = false,
  command = '',
  extraAuthorized = false,
} = {}) {
  const m = normalizeMode(vendor, mode);
  const commandRisk = kind === EXEC ? inspectCommand(command) : null;
  const full = isFullAccess(vendor, m);

  if (outsideWorkspace && kind !== READ && kind !== NONE && kind !== ASK) {
    if (full || extraAuthorized) {
      // fully authorized sessions may leave the project tree
    } else {
      return { action: 'ask', reason: '工作区外路径需要额外授权', commandRisk };
    }
  }

  if (kind === NONE || kind === READ) return { action: 'allow', commandRisk };
  if (kind === ASK) return { action: 'ask', commandRisk };

  if (full) return { action: 'allow', commandRisk };

  if (m === 'dontAsk') {
    return {
      action: kind === READ || kind === NONE ? 'allow' : 'deny',
      reason: 'dontAsk 仅允许预批与只读',
      commandRisk,
    };
  }

  if (m === 'plan' || planLocked) {
    if (kind === WRITE || kind === EXEC) return { action: 'deny', reason: 'plan 模式只读，先交出方案再改', commandRisk };
    return { action: kind === NET ? 'ask' : 'allow', commandRisk };
  }

  if (m === 'accept-edits' || m === 'acceptEdits') {
    if (kind === WRITE) return { action: 'allow', commandRisk };
    if (kind === EXEC) {
      if (commandRisk?.needsConfirm) return { action: 'ask', reason: commandRisk.reason, commandRisk };
      return { action: 'ask', commandRisk };
    }
    if (kind === NET) return { action: 'ask', commandRisk };
    return { action: 'allow', commandRisk };
  }

  if (vendor === 'codex' && m === 'untrusted') {
    return { action: kind === READ ? 'allow' : 'ask', commandRisk };
  }

  if (vendor === 'codex' && m === 'on-failure') {
    if (kind === EXEC && commandRisk?.needsConfirm) {
      return { action: 'ask', reason: commandRisk.reason, commandRisk };
    }
    if (kind === WRITE || kind === NET) return { action: 'allow', commandRisk };
    if (kind === EXEC) return { action: 'allow', commandRisk };
    return { action: 'ask', commandRisk };
  }

  if (m === 'auto') {
    if (kind === WRITE) return { action: 'allow', commandRisk };
    if (kind === EXEC) {
      if (commandRisk?.needsConfirm) return { action: 'ask', reason: commandRisk.reason, commandRisk };
      return { action: 'allow', commandRisk };
    }
    if (kind === NET) return { action: 'ask', commandRisk };
    return { action: 'allow', commandRisk };
  }

  if (kind === EXEC && commandRisk?.needsConfirm) {
    return { action: 'ask', reason: commandRisk.reason, commandRisk };
  }
  if (kind === WRITE || kind === EXEC || kind === NET) return { action: 'ask', commandRisk };
  return { action: 'allow', commandRisk };
}

export function planWritablePath(vendor, filePath) {
  if (vendor !== 'grok' && vendor !== 'claude') return false;
  return /(?:^|[\\/])plan\.md$/i.test(String(filePath || ''));
}

export { inspectCommand, commandLineOf };
