const CATALOG = {
  codex: {
    product: 'ChatGPT',
    title: '应如何批准 ChatGPT 操作？',
    defaultMode: 'on-request',
    modes: [
      { id: 'on-request', icon: 'hand', chip: '请求批准', label: '请求批准', description: '编辑外部文件和使用互联网时始终询问', warn: false },
      { id: 'on-failure', icon: 'shield', chip: '帮我批准', label: '帮我批准', description: '普通读写可过；删文件、提权、管道下载执行仍要问', warn: false },
      { id: 'never', icon: 'warn', chip: '完全访问', label: '完全访问权限', description: '全自动：文件、命令和网络都不再询问', warn: true },
      { id: 'untrusted', icon: 'lock', chip: '不信任', label: '不信任', description: '除读取外，文件、命令和网络都要先问', warn: false },
    ],
  },
  claude: {
    product: 'Claude',
    title: '应如何批准 Claude 操作？',
    defaultMode: 'default',
    modes: [
      { id: 'default', icon: 'hand', chip: '默认', label: '默认', description: '危险工具先问，工作区内只读自动过', warn: false },
      { id: 'acceptEdits', icon: 'edit', chip: '接受编辑', label: '接受编辑', description: '文件编辑自动过，命令和联网仍要问', warn: false },
      { id: 'plan', icon: 'plan', chip: '计划', label: '计划', description: '只读调研，确认方案后再改', warn: false },
      { id: 'auto', icon: 'auto', chip: '自动', label: '自动', description: '工作区内写文件和普通命令可过，高风险仍要问', warn: false },
      { id: 'dontAsk', icon: 'deny', chip: '不问', label: '不问', description: '未预批的一律拒绝，适合无人值守', warn: false },
      { id: 'bypassPermissions', icon: 'warn', chip: '完全访问', label: '完全访问', description: '全自动：跳过确认', warn: true },
    ],
  },
  grok: {
    product: 'Grok',
    title: '应如何批准 Grok 操作？',
    defaultMode: 'default',
    modes: [
      { id: 'default', icon: 'hand', chip: '默认', label: '默认', description: '只读自动过，改动要问', warn: false },
      { id: 'acceptEdits', icon: 'edit', chip: '接受编辑', label: '接受编辑', description: '文件编辑不问，命令和联网仍要问', warn: false },
      { id: 'plan', icon: 'plan', chip: '计划', label: '计划', description: '只读调研，确认后再改', warn: false },
      { id: 'auto', icon: 'auto', chip: '自动', label: '自动', description: '工作区内写文件和普通命令可过，高风险仍要问', warn: false },
      { id: 'dontAsk', icon: 'deny', chip: '不问', label: '不问', description: '只跑预批和内置只读', warn: false },
      { id: 'bypassPermissions', icon: 'warn', chip: '完全访问', label: '完全访问', description: '全自动：跳过普通询问', warn: true },
    ],
  },
  agy: {
    product: 'Gemini',
    title: '应如何批准 Gemini 操作？',
    defaultMode: 'default',
    modes: [
      { id: 'default', icon: 'hand', chip: '默认', label: '默认', description: '写文件弹 diff，等你批准', warn: false },
      { id: 'accept-edits', icon: 'edit', chip: '接受编辑', label: '接受编辑', description: '文件读写自动落盘，子任务同样继承', warn: false },
      { id: 'plan', icon: 'plan', chip: '计划', label: '计划', description: '只读调研，交出方案并确认后再改', warn: false },
      { id: 'auto', icon: 'auto', chip: '自动', label: '自动', description: '工作区内写文件和普通命令可过，高风险仍要问', warn: false },
      { id: 'bypassPermissions', icon: 'warn', chip: '完全访问', label: '完全访问', description: '全自动：跳过确认', warn: true },
    ],
  },
  custom: {
    product: '此模型',
    title: '应如何批准此模型操作？',
    defaultMode: 'default',
    modes: [
      { id: 'default', icon: 'hand', chip: '默认', label: '默认', description: '该协议没有独立权限档，按默认策略询问', warn: false },
      { id: 'auto', icon: 'auto', chip: '自动', label: '自动', description: '工作区内写文件和普通命令可过，高风险仍要问', warn: false },
      { id: 'bypassPermissions', icon: 'warn', chip: '完全访问', label: '完全访问', description: '全自动：跳过确认', warn: true },
    ],
  },
};

export const VENDOR_MODES = Object.fromEntries(
  Object.entries(CATALOG).map(([vendor, spec]) => [vendor, spec.modes.map(item => item.id)]),
);

export const DEFAULT_MODE = Object.fromEntries(
  Object.entries(CATALOG).map(([vendor, spec]) => [vendor, spec.defaultMode]),
);

function catalogOf(vendor) {
  return CATALOG[vendor] || CATALOG.custom;
}

export function aliasMode(vendor, mode) {
  const raw = String(mode || '').trim();
  if (!raw) return '';
  if (raw === 'manual') return 'default';
  if (raw === 'always-approve' || raw === 'always-proceed') return 'bypassPermissions';
  if (raw === 'full-auto' || raw === 'full_access') {
    return vendor === 'codex' ? 'never' : 'bypassPermissions';
  }
  if (vendor === 'agy' && raw === 'acceptEdits') return 'accept-edits';
  if ((vendor === 'claude' || vendor === 'grok') && raw === 'accept-edits') return 'acceptEdits';
  return raw;
}

export function normalizeMode(vendor, mode) {
  const allowed = VENDOR_MODES[vendor] || VENDOR_MODES.custom;
  const value = aliasMode(vendor, mode);
  if (allowed.includes(value)) return value;
  return DEFAULT_MODE[vendor] || 'default';
}

export function cycleMode(vendor, mode) {
  const allowed = VENDOR_MODES[vendor] || VENDOR_MODES.custom;
  const current = normalizeMode(vendor, mode);
  const index = Math.max(0, allowed.indexOf(current));
  return allowed[(index + 1) % allowed.length];
}

export function modeOptions(vendor) {
  return catalogOf(vendor).modes.map(item => ({ ...item }));
}

export function describeMode(vendor, mode) {
  const id = normalizeMode(vendor, mode);
  const spec = catalogOf(vendor);
  const item = spec.modes.find(entry => entry.id === id) || spec.modes[0];
  return {
    ...item,
    product: spec.product,
    title: spec.title,
  };
}

export function modeMenuTitle(vendor) {
  return catalogOf(vendor).title;
}
