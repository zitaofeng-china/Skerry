import { esc } from './shell.js';
import { describeMode, modeMenuTitle, modeOptions } from './permission-modes.js';
import { REASONING_LABELS } from './model-selection.js';

export const chat = {
  messages: [],
  streaming: false,
  vendor: '',
  vendorLabel: '',
  mode: 'default',
  hitl: null,
  question: null,
  draft: '',
  error: '',
  thoughts: '',
  streamText: '',
  target: 'manager',
  sessionId: '',
  context: null,
  modeMenuOpen: false,
  effort: '',
  effortLevels: [],
};

export const group = {
  events: [],
  streaming: false,
  streamText: '',
  error: '',
  draft: '',
  context: null,
  mode: '',
  vendor: '',
};

export function resetChat() {
  chat.messages = [];
  chat.streaming = false;
  chat.hitl = null;
  chat.question = null;
  chat.error = '';
  chat.thoughts = '';
  chat.streamText = '';
  chat.context = null;
  chat.modeMenuOpen = false;
  chat.vendor = '';
  chat.vendorLabel = '';
  chat.mode = 'default';
  chat.effort = '';
  chat.effortLevels = [];
}

export function resetGroup() {
  group.events = [];
  group.streaming = false;
  group.streamText = '';
  group.error = '';
  group.context = null;
  group.mode = '';
  group.vendor = '';
}

const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.2v9.6M3.8 7.4 8 3.2l4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_ICON = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
const WARN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.7 14H1.3L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.4v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="12.1" r=".8" fill="currentColor"/></svg>';

export function formatTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1000000) return `${(v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
}

const QUOTA_RING_R = 6;
const QUOTA_RING_C = 2 * Math.PI * QUOTA_RING_R;

export function formatQuota(ctx) {
  const window = Math.max(0, Number(ctx?.window) || 0);
  const used = Math.max(0, Number(ctx?.used) || 0);
  if (!window) {
    return {
      text: '—',
      level: '',
      ratio: 0,
      percent: 0,
      title: '未配置上下文窗口',
      lines: ['背景信息窗口：', '未配置上下文窗口'],
    };
  }
  const ratio = Math.min(1, used / window);
  const percent = Math.round(ratio * 100);
  const usedLabel = formatTokens(used);
  const windowLabel = formatTokens(window);
  return {
    text: `${usedLabel} / ${windowLabel}`,
    level: ratio >= 0.9 ? 'full' : ratio >= 0.75 ? 'warn' : '',
    ratio,
    percent,
    title: `背景信息窗口：${percent}% 已用。已用 ${usedLabel} 标记，共 ${windowLabel}`,
    lines: ['背景信息窗口：', `${percent}% 已用`, `已用 ${usedLabel} 标记，共 ${windowLabel}`],
  };
}

function quotaRingHtml(quota) {
  const ratio = Math.min(1, Math.max(0, Number(quota.ratio) || 0));
  const offset = (QUOTA_RING_C * (1 - ratio)).toFixed(3);
  const level = quota.level ? ` is-${quota.level}` : '';
  const arc = ratio > 0.001
    ? `<circle class="compose-quota-value" cx="8" cy="8" r="${QUOTA_RING_R}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="${QUOTA_RING_C.toFixed(3)}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"/>`
    : '';
  const tip = (quota.lines || []).map(line => `<span>${esc(line)}</span>`).join('');
  return `<span class="compose-quota${level}" data-compose-quota tabindex="0" aria-label="${esc(quota.title)}">
    <svg class="compose-quota-ring" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle class="compose-quota-track" cx="8" cy="8" r="${QUOTA_RING_R}" fill="none" stroke-width="1.8"/>
      ${arc}
    </svg>
    <span class="compose-quota-tip" role="tooltip">${tip}</span>
  </span>`;
}

const MODE_ICONS = {
  hand: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 8.2V4.6a1.1 1.1 0 0 1 2.2 0v2.3m0 0V4.2a1.1 1.1 0 1 1 2.2 0v3.1m0 0V5.2a1.1 1.1 0 1 1 2.2 0v5.2c0 2.2-1.5 3.8-3.8 3.8H8.2C6 14.2 4.2 12.7 3.5 10.6L2.8 8.4A1.3 1.3 0 0 1 5.2 7.6l1 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2 13 4v4.1c0 3-1.9 4.8-5 5.7-3.1-.9-5-2.7-5-5.7V4l5-1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m5.8 8 1.5 1.5 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: WARN_ICON,
  lock: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  plan: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.2 3.6 12.4 6.8M3 13l.7-3.3L10.6 3l3.1 3.1-6.8 6.8L3 13Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  auto: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.4 9.1 6l3.7.2L10 8.6l1.2 3.5L8 10.2 4.8 12.1 6 8.6 3.2 6.2 6.9 6 8 2.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  deny: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.3" stroke="currentColor" stroke-width="1.3"/><path d="m5.2 10.8 5.6-5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};
const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.6 8.2 3 3 6-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function actorVendor(isGroup) {
  return isGroup ? (group.vendor || chat.vendor) : (chat.vendor || group.vendor);
}

function actorMode(isGroup) {
  return isGroup ? (group.mode || chat.mode) : chat.mode;
}

function modeChip(vendor, mode) {
  const meta = describeMode(vendor, mode);
  return { label: meta.chip || meta.label, warn: Boolean(meta.warn) };
}

function modeMenuHtml(vendor, mode) {
  const current = describeMode(vendor, mode).id;
  const items = modeOptions(vendor).map(opt => {
    const active = opt.id === current;
    const warn = opt.warn ? ' is-warn' : '';
    const on = active ? ' is-active' : '';
    return `<button type="button" role="menuitemradio" class="compose-mode-option${on}${warn}" data-action="chat-mode-set" data-mode="${esc(opt.id)}" aria-checked="${active}">
      <span class="compose-mode-option-icon">${MODE_ICONS[opt.icon] || MODE_ICONS.hand}</span>
      <span class="compose-mode-option-copy"><span class="compose-mode-option-label">${esc(opt.label)}</span><span class="compose-mode-option-desc">${esc(opt.description)}</span></span>
      ${active ? `<span class="compose-mode-option-check">${CHECK_ICON}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="compose-mode-menu" role="menu">
    <div class="compose-mode-menu-head">${esc(modeMenuTitle(vendor))}</div>
    ${items}
  </div>`;
}

function composeSendHtml({ streaming, isGroup, draft = '' }) {
  const empty = !String(draft || '').trim();
  const abort = isGroup ? ' data-scope="group"' : '';
  if (streaming) {
    return `<button type="button" class="compose-send is-stop" data-action="chat-abort"${abort} aria-label="停止">${STOP_ICON}</button>`;
  }
  return `<button type="submit" class="compose-send" aria-label="发送"${empty ? ' disabled' : ''}>${SEND_ICON}</button>`;
}

function effortChipsHtml() {
  const levels = chat.effortLevels?.length ? chat.effortLevels : [];
  if (!levels.length) return '';
  const current = chat.effort || '';
  const chips = levels.map(level => {
    const on = level === current ? ' is-active' : '';
    return `<button type="button" class="compose-effort${on}" data-action="chat-effort" data-effort="${esc(level)}">${esc(REASONING_LABELS[level] || level)}</button>`;
  }).join('');
  return `<div class="compose-effort-row" role="group" aria-label="推理力度">${chips}</div>`;
}

function composeRowHtml({ streaming, isGroup, draft = '' }) {
  const ctx = isGroup ? group.context : chat.context;
  const vendor = actorVendor(isGroup);
  const mode = actorMode(isGroup);
  const chip = modeChip(vendor, mode);
  const quota = formatQuota(ctx);
  const warn = chip.warn ? ' is-warn' : '';
  const open = chat.modeMenuOpen;
  return `<div class="chat-compose-row">
    <div class="compose-left">
      <div class="compose-mode-wrap">
        <button type="button" class="compose-mode${warn}" data-action="chat-mode" title="切换权限模式" aria-haspopup="menu" aria-expanded="${open}">${chip.warn ? WARN_ICON : ''}<span>${esc(chip.label)}</span></button>
        ${open ? modeMenuHtml(vendor, mode) : ''}
      </div>
      ${effortChipsHtml()}
    </div>
    <div class="compose-right">
      ${quotaRingHtml(quota)}
      ${composeSendHtml({ streaming, isGroup, draft })}
    </div>
  </div>`;
}

function composeForm({ streaming, draft, isGroup }) {
  const disabled = streaming ? 'disabled' : '';
  return `<form class="chat-compose" data-chat-form${isGroup ? ' data-group-form' : ''}>
    <textarea name="text" rows="1" placeholder="随心输入" ${disabled}>${esc(draft)}</textarea>
    ${composeRowHtml({ streaming, isGroup, draft })}
  </form>`;
}

export function fitCompose(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(200, Math.max(28, el.scrollHeight))}px`;
  const btn = el.form?.querySelector('.compose-send:not(.is-stop)');
  if (btn) btn.disabled = !String(el.value || '').trim();
}

export function patchCompose() {
  if (typeof document === 'undefined') return;
  const form = document.querySelector('[data-chat-form]');
  if (!form) return;
  const isGroup = form.hasAttribute('data-group-form');
  const streaming = isGroup ? group.streaming : chat.streaming;
  const area = form.querySelector('textarea');
  const draft = area ? area.value : (isGroup ? group.draft : chat.draft);
  const row = form.querySelector('.chat-compose-row');
  if (row) row.outerHTML = composeRowHtml({ streaming, isGroup, draft });
  if (area) {
    area.disabled = streaming;
    fitCompose(area);
  }
}

export function toolFilePath(tc) {
  const a = tc?.args || {};
  return String(a.path || a.file_path || a.filePath || a.target_file || a.TargetFile || '').trim();
}

export function chatPanel({ session, partition, managerReady, projectPath = '', managerLabel = '' }) {
  if (session?.id) chat.sessionId = session.id;
  const title = partition ? partition.name : '管理者AI';
  const who = partition ? (chat.vendorLabel || '分区 Agent') : (managerLabel ? `管理者 AI · ${managerLabel}` : '管理者 AI');
  const hint = partition
    ? `本分区走 ${esc(chat.vendorLabel || '对应产品')} 的真实工具环，不是一次 hi 测试。`
    : managerReady
      ? '你在跟管理者说话。可在设置里切换管理者；正在进行的回复不会被切换改掉。'
      : '先在设置中选择管理者 AI。';
  const messages = chat.messages.map(renderMessage).join('') + (chat.streaming ? renderStreaming() : '');
  const hitl = chat.hitl ? renderHitl(chat.hitl) : '';
  const question = chat.question ? renderQuestion(chat.question) : '';
  const empty = !chat.messages.length && !chat.streaming
    ? `<div class="chat-empty">${hint}</div>`
    : '';
  const back = session
    ? `<button type="button" data-action="back-to-group" data-session="${esc(session.id)}">返回会话</button>`
    : '';
  const where = [projectPath, who || title].filter(Boolean).join(' · ');
  return `
    <div class="chat-shell" data-chat-root>
      <div class="chat-head chat-status">
        <div class="chat-status-copy muted">${esc(where)}</div>
        <div class="chat-meta">
          ${back}
        </div>
      </div>
      <div class="chat-log" id="chat-log">${empty}${messages}</div>
      ${chat.error ? `<div class="chat-error">${esc(chat.error)}</div>` : ''}
      ${hitl}${question}
      ${composeForm({ streaming: chat.streaming, draft: chat.draft, isGroup: false })}
    </div>`;
}

function parseJsonish(value) {
  if (value && typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function overlayKind(name) {
  const n = String(name || '');
  if (n === 'workbench_dispatch') return 'dispatch';
  if (n === 'workbench_spawn_clone') return 'clone';
  if (n === 'workbench_list_targets' || n === 'workbench_list_partitions') return 'list';
  return '';
}

function overlayStreamNote(name) {
  const kind = overlayKind(name);
  if (kind === 'dispatch') return '正在派发…';
  if (kind === 'clone') return '正在开分身…';
  if (kind === 'list') return '正在查看可派发目标…';
  return `[${name}]`;
}

function renderOverlayCard(tc, result) {
  const kind = overlayKind(tc.name);
  const args = tc.args || {};
  const parsed = parseJsonish(result?.output) || {};
  const err = String(result?.error || (parsed.ok === false ? (parsed.error || '失败') : '') || '').trim();
  if (kind === 'list') {
    const pool = Array.isArray(parsed.pool) ? parsed.pool : [];
    const n = pool.length;
    const copy = err ? `查看目标失败：${err}` : (n ? `已查看可派发目标 · ${n} 个` : '已查看可派发目标');
    return `<div class="overlay-note">${esc(copy)}</div>`;
  }
  const live = String(parsed.taskId || '')
    ? (group.events || []).find(e => e.type === 'task' && e.taskId === parsed.taskId)
    : null;
  const status = err ? 'failed' : (live?.status || parsed.status || (parsed.ok ? 'running' : ''));
  const label = kind === 'clone'
    ? (live?.name || parsed.name || '分身')
    : (live?.vendorLabel || live?.name || parsed.name || parsed.vendorLabel || args.connectionId || args.model || '执行');
  const origin = kind === 'clone' ? '分身' : '管理者派发';
  const done = status === 'completed' || status === 'failed';
  const summary = String(
    done
      ? (live?.summary || err || parsed.summary || args.prompt || '')
      : (args.prompt || live?.summary || parsed.summary || err || '')
  ).slice(0, done ? 800 : 160);
  const partitionId = String(parsed.partitionId || live?.partitionId || '');
  const sessionId = chat.sessionId || '';
  const clickable = Boolean(partitionId && sessionId);
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable
    ? ` type="button" data-action="open-task" data-session="${esc(sessionId)}" data-id="${esc(partitionId)}" data-kind="${kind === 'clone' ? 'clone' : 'execution'}"`
    : '';
  return `<${tag} class="task-card overlay-card kind-${kind === 'clone' ? 'clone' : 'execution'} status-${esc(status)}"${attrs}>
    <span class="task-card-kicker">${esc(label)} · ${esc(origin)}${status ? ` · ${esc(taskStatusLabel(status))}` : ''}</span>
    ${summary ? `<small>${esc(summary)}</small>` : ''}
  </${tag}>`;
}

function renderToolCard(tc, result) {
  if (overlayKind(tc.name)) return renderOverlayCard(tc, result);
  const filePath = toolFilePath(tc);
  const open = filePath
    ? `<button type="button" class="tool-open" data-action="open-file" data-id="${esc(filePath)}">打开</button>`
    : '';
  const args = tc.args || {};
  const headline = filePath || args.command || args.cmd || args.script || args.path || args.file || '';
  const body = headline
    ? `<div class="tool-headline">${esc(String(headline))}</div>`
    : `<pre>${esc(JSON.stringify(args, null, 2))}</pre>`;
  const out = result ? String(result.output || result.error || '') : '';
  return `<div class="tool-card"><div class="tool-name">${esc(tc.name)}${open}</div>${body}${out ? `<pre class="tool-out">${esc(out.slice(0, 2000))}</pre>` : ''}</div>`;
}

function renderMessage(m) {
  if (m.kind === 'compaction') {
    if (m.role === 'assistant') return '';
    const body = m.name === 'command'
      ? '已执行 /compact，同一会话继续。'
      : '已到窗口 90%，自动执行 /compact 并继续同一会话。';
    return `<article class="bubble note compact"><div class="bubble-label">上下文压缩</div><div class="bubble-body">${body}</div></article>`;
  }
  if (m.role === 'user') {
    return `<article class="bubble user"><div class="bubble-label">你</div><div class="bubble-body">${esc(m.content)}</div></article>`;
  }
  if (m.kind === 'clone_result') {
    return `<article class="bubble assistant clone-result">
      <div class="bubble-label">分身完成</div>
      <div class="bubble-body">${esc(m.content)}</div>
    </article>`;
  }
  if (m.kind === 'dispatch_result' || m.kind === 'job_error') {
    const failed = m.status === 'failed' || m.kind === 'job_error';
    const who = m.name || (m.kind === 'job_error' ? (chat.vendorLabel || '执行') : '执行');
    const label = `${who} · ${failed ? '失败' : taskStatusLabel(m.status || 'completed')}`;
    return `<article class="bubble assistant dispatch-result${failed ? ' status-failed' : ''}">
      <div class="bubble-label">${esc(label)}</div>
      <div class="bubble-body">${esc(m.content)}</div>
    </article>`;
  }
  const tools = (m.toolCalls || []).map((tc, i) => renderToolCard(tc, (m.toolResults || [])[i])).join('');
  return `<article class="bubble assistant">
    <div class="bubble-label">${esc(chat.vendorLabel || 'Agent')}</div>
    ${m.thoughts ? `<details class="thoughts"><summary>推理</summary><pre>${esc(m.thoughts)}</pre></details>` : ''}
    ${m.content ? `<div class="bubble-body">${esc(m.content)}</div>` : ''}
    ${tools}
  </article>`;
}

function taskStatusLabel(status) {
  return { running: '进行中', waiting: '等待确认', completed: '完成', failed: '失败' }[status] || status || '任务';
}

export function renderTaskCard(ev, sessionId) {
  const kind = ev.kind === 'clone' ? 'clone' : 'execution';
  const label = kind === 'clone' ? '分身' : (ev.vendorLabel || ev.name || '执行');
  const origin = ev.source === 'user' ? '你下达' : (kind === 'clone' ? '分身' : '管理者派发');
  return `<button type="button" class="task-card kind-${kind} status-${esc(ev.status || '')}" data-action="open-task" data-session="${esc(sessionId)}" data-id="${esc(ev.partitionId || '')}" data-kind="${kind}">
    <span class="task-card-kicker">${esc(label)} · ${esc(origin)} · ${esc(taskStatusLabel(ev.status))}</span>
    <strong>${esc(ev.name || label)}</strong>
    <small>${esc((ev.summary || ev.content || '').slice(0, 160))}</small>
  </button>`;
}

export function liveTasks(events = group.events) {
  return events.filter(e => e.type === 'task' && (e.status === 'running' || e.status === 'waiting'));
}

export function renderLiveActions(live) {
  if (!live.length) return '';
  return `<span class="badge">${live.length} 进行中</span><button type="button" data-action="chat-abort" data-scope="group">全部停止</button>`;
}

export function renderLiveBoard(sessionId, live) {
  if (!live.length) return '';
  return `<section class="context-tasks" aria-label="执行中">
    <div class="group-board-head"><span>进行中</span><button type="button" data-action="chat-abort" data-scope="group">全部停止</button></div>
    <div class="group-board-body" data-group-board>${live.map(ev => renderTaskCard(ev, sessionId)).join('')}</div>
  </section>`;
}

export function renderTaskBox(sessionId, partitionId, tasks) {
  const box = tasks.length
    ? tasks.map(ev => renderTaskCard(ev, sessionId)).join('')
    : '<p class="muted extension-empty">还没有派给这个 AI 的任务</p>';
  return `<section class="context-tasks" aria-label="任务箱">
    <div class="group-board-head">任务箱</div>
    <div class="group-board-body" data-task-box data-partition="${esc(partitionId)}">${box}</div>
  </section>`;
}

function renderGroupEvent(ev, sessionId) {
  if (ev.type === 'user') return `<article class="bubble user"><div class="bubble-label">你</div><div class="bubble-body">${esc(ev.content)}</div></article>`;
  if (ev.type === 'manager') {
    const who = ev.vendorLabel || '管理者';
    return `<article class="bubble assistant"><div class="bubble-label">${esc(who)}</div><div class="bubble-body">${esc(ev.content)}</div></article>`;
  }
  if (ev.type === 'note') return `<article class="bubble note"><div class="bubble-label">系统</div><div class="bubble-body">${esc(ev.content)}</div></article>`;
  if (ev.type === 'worker') {
    const failed = ev.status === 'failed';
    const who = ev.vendorLabel || ev.name || '执行';
    const label = `${who} · ${taskStatusLabel(ev.status || 'completed')}`;
    return `<article class="bubble assistant worker-result${failed ? ' status-failed' : ''}">
      <div class="bubble-label">${esc(label)}</div>
      <div class="bubble-body">${esc(ev.content || ev.summary || '')}</div>
    </article>`;
  }
  if (ev.type === 'task' && ev.source !== 'user') return renderTaskCard(ev, sessionId);
  return '';
}

export function patchTaskBox(sessionId) {
  if (typeof document === 'undefined') return;
  const box = document.querySelector('[data-task-box]');
  if (!box) return;
  const partitionId = box.getAttribute('data-partition');
  const tasks = group.events.filter(e => e.type === 'task' && e.partitionId === partitionId);
  box.innerHTML = tasks.length
    ? tasks.map(ev => renderTaskCard(ev, sessionId || '')).join('')
    : '<p class="muted extension-empty">还没有派给这个 AI 的任务</p>';
}

function upsertGroupEvent(ev) {
  if (!ev?.id) return;
  const idx = group.events.findIndex(e => e.id === ev.id);
  if (idx >= 0) group.events[idx] = { ...group.events[idx], ...ev };
  else group.events.push(ev);
}

export function applySessionEvent(event, data, { sessionId, selectedPartition, viewingManager } = {}) {
  const selected = typeof selectedPartition === 'function' ? selectedPartition() : selectedPartition;
  const managerView = typeof viewingManager === 'function' ? viewingManager() : Boolean(viewingManager);
  if (event === 'group_timeline') {
    group.events = data.events || [];
    patchGroup(sessionId);
    return;
  }
  if (event === 'group_event') {
    upsertGroupEvent(data);
    schedulePatchGroup(sessionId);
    if (managerView) patchLog();
    return;
  }
  if (event === 'clone_result') {
    if (managerView && data.text) {
      chat.messages.push({ role: 'assistant', content: data.text, kind: 'clone_result' });
      patchLog();
    }
    return;
  }
  if (event === 'dispatch_result') {
    if (managerView && data.text) {
      chat.messages.push({
        role: 'assistant',
        content: data.text,
        kind: 'dispatch_result',
        name: data.name || '',
        status: data.status || 'completed',
      });
    }
    patchLog();
    return;
  }
  const forThisPartition = data?.partitionId && selected && data.partitionId === selected;
  const cloneForManager = managerView && data?.via === 'clone' && (event === 'hitl_request' || event === 'hitl_resolved' || event === 'question');
  if (forThisPartition) {
    if (event === 'text_delta' || event === 'chat_start' || event === 'tool_call') chat.streaming = true;
    applyEvent(event, data);
    return;
  }
  if (cloneForManager) applyEvent(event, data);
}

export function groupPanel({ session, projectPath, managerReady, managerLabel = '' }) {
  const sessionId = session.id;
  const live = liveTasks();
  const streamWho = chat.vendorLabel || '管理者';
  const log = group.events.map(ev => renderGroupEvent(ev, sessionId)).join('')
    + (group.streaming ? `<article class="bubble assistant streaming"><div class="bubble-label">${esc(streamWho)}</div><div class="bubble-body">${esc(group.streamText)}</div></article>` : '');
  const empty = !group.events.length && !group.streaming
    ? `<div class="chat-empty">${managerReady ? '这是这场会话的群聊。对管理者说话；要干活时它会派到执行会话。分身只属于管理者，不会出现在其他 AI 里。' : '先在设置中选择管理者 AI。'}</div>`
    : '';
  const actor = managerLabel ? ` · ${managerLabel}` : '';
  return `<div class="chat-shell" data-group-chat data-chat-root>
      <div class="chat-head chat-status">
        <div class="chat-status-copy muted">${esc(projectPath || '')} · 群聊${esc(actor)}</div>
        <div class="chat-meta"><span data-live-actions>${renderLiveActions(live)}</span></div>
      </div>
      <div class="chat-log" id="group-log">${empty}${log}</div>
      ${group.error ? `<div class="chat-error">${esc(group.error)}</div>` : ''}
      ${composeForm({ streaming: group.streaming, draft: group.draft, isGroup: true })}
    </div>`;
}

export function patchGroup(sessionId) {
  if (typeof document === 'undefined') return;
  if (groupFrame) cancelAnimationFrame(groupFrame);
  groupFrame = 0;
  pendingGroupId = sessionId || pendingGroupId;
  const log = document.querySelector('#group-log');
  if (log) {
    const streamWho = chat.vendorLabel || '管理者';
    log.innerHTML = group.events.map(ev => renderGroupEvent(ev, pendingGroupId || '')).join('')
      + (group.streaming ? `<article class="bubble assistant streaming"><div class="bubble-label">${esc(streamWho)}</div><div class="bubble-body" data-group-stream>${esc(group.streamText)}</div></article>` : '');
  }
  scrollChatToLatest();
  const live = liveTasks();
  const host = document.querySelector('[data-context-tasks]');
  if (host) host.innerHTML = renderLiveBoard(pendingGroupId || '', live);
  const actions = document.querySelector('[data-live-actions]');
  if (actions) actions.innerHTML = renderLiveActions(live);
  patchTaskBox(pendingGroupId);
}

function schedulePatchGroup(sessionId) {
  pendingGroupId = sessionId || pendingGroupId;
  if (typeof requestAnimationFrame !== 'function') {
    patchGroup(pendingGroupId);
    return;
  }
  if (groupFrame) return;
  groupFrame = requestAnimationFrame(() => {
    groupFrame = 0;
    patchGroup(pendingGroupId);
  });
}

export async function loadGroupHistory(api, sessionId) {
  const data = await api('group/history', { sessionId });
  group.events = data.events || [];
  group.error = '';
  group.streaming = false;
  group.context = data.context || null;
  group.mode = data.mode || '';
  group.vendor = data.vendor || '';
  group.streamText = '';
  if (data.vendor && !chat.vendor) chat.vendor = data.vendor;
  if (data.vendorLabel && !chat.vendorLabel) chat.vendorLabel = data.vendorLabel;
  return data;
}

function renderStreaming() {
  return `<article class="bubble assistant streaming">
    <div class="bubble-label">${esc(chat.vendorLabel || 'Agent')}</div>
    ${chat.thoughts ? `<details class="thoughts" open><summary>推理</summary><pre data-stream-thoughts>${esc(chat.thoughts)}</pre></details>` : ''}
    <div class="bubble-body" data-stream-text>${esc(chat.streamText)}</div>
  </article>`;
}

function renderHitl(h) {
  return `<div class="hitl-card" data-hitl-id="${esc(h.id)}">
    <strong>需要批准</strong>
    <p>${esc(h.summary || h.toolName)}</p>
    <pre>${esc(JSON.stringify(h.args || {}, null, 2).slice(0, 1500))}</pre>
    <div class="row">
      <button class="primary" data-action="chat-hitl" data-ok="1">允许</button>
      <button data-action="chat-hitl" data-ok="0">拒绝</button>
    </div>
  </div>`;
}

function renderQuestion(q) {
  const items = (q.questions || []).map((question, qi) => {
    const opts = (question.options || []).concat([{ label: 'Other', description: '自己填写' }]);
    return `<fieldset class="q-block"><legend>${esc(question.question || question.header || '问题')}</legend>${opts.map((opt, oi) => `<label class="q-opt"><input type="${question.multiSelect || question.multi_select ? 'checkbox' : 'radio'}" name="q${qi}" value="${esc(opt.label)}"> <span>${esc(opt.label)}</span><small class="muted">${esc(opt.description || '')}</small></label>`).join('')}</fieldset>`;
  }).join('');
  return `<form class="hitl-card" data-question-form data-id="${esc(q.id || '')}">${items}<button class="primary" type="submit">提交回答</button></form>`;
}

export async function loadChatHistory(api, sessionId, partitionId) {
  const data = await api('chat/history', { sessionId, partitionId: partitionId || undefined });
  chat.sessionId = sessionId || chat.sessionId;
  chat.messages = data.messages || [];
  chat.vendor = data.vendor || '';
  chat.vendorLabel = data.vendorLabel || '';
  chat.mode = data.mode || 'default';
  chat.target = data.target || 'manager';
  chat.hitl = data.hitl || null;
  chat.question = data.question || null;
  chat.error = '';
  chat.streaming = false;
  chat.thoughts = '';
  chat.streamText = '';
  chat.context = data.context || null;
  return data;
}

export async function setChatMode(api, sessionId, partitionId, mode) {
  const data = await api('chat/mode', {
    sessionId,
    partitionId: partitionId || undefined,
    mode,
  });
  chat.mode = data.mode;
  chat.vendor = data.vendor || chat.vendor;
  if (!partitionId) {
    group.mode = data.mode;
    group.vendor = data.vendor || group.vendor;
  }
  return data;
}

function applyEvent(event, data) {
  const inGroup = Boolean(document.querySelector('[data-group-chat]'));
  if (event === 'group_event') {
    upsertGroupEvent(data);
    schedulePatchGroup(data.sessionId);
    return;
  }
  if (event === 'group_timeline') {
    group.events = data.events || [];
    patchGroup();
    return;
  }
  if (event === 'chat_start') {
    chat.vendor = data.vendor || chat.vendor;
    chat.vendorLabel = data.vendorLabel || chat.vendorLabel;
    chat.mode = data.mode || chat.mode;
    chat.streaming = true;
    chat.error = '';
    chat.thoughts = '';
    chat.streamText = '';
    if (inGroup) {
      group.streaming = true;
      group.streamText = '';
      group.error = '';
    }
  } else if (event === 'user_message') {
    chat.messages.push(data);
  } else if (event === 'text_delta') {
    if (data.via && inGroup) return;
    chat.streamText += data.delta || '';
    if (inGroup) {
      group.streamText += data.delta || '';
      if (document.querySelector('[data-group-stream]')) scheduleStreamPaint();
      else schedulePatchGroup();
      return;
    }
    if (document.querySelector('[data-stream-text]')) scheduleStreamPaint();
    else patchLog();
    return;
  } else if (event === 'thought_delta') {
    if (inGroup) return;
    chat.thoughts += data.delta || '';
    if (document.querySelector('[data-stream-thoughts]')) scheduleStreamPaint();
    else patchLog();
    return;
  } else if (event === 'tool_call') {
    if (inGroup) return;
    chat.streamText += `\n\n${overlayStreamNote(data.name)}`;
    patchLog();
    return;
  } else if (event === 'hitl_request') {
    chat.hitl = data;
  } else if (event === 'hitl_resolved') {
    chat.hitl = null;
  } else if (event === 'question') {
    chat.question = data;
  } else if (event === 'tool_result') {
    if (inGroup) return;
    patchLog();
    return;
  } else if (event === 'compacted') {
    if (Array.isArray(data.messages)) chat.messages = data.messages;
    applyContext(data);
  } else if (event === 'agent_done') {
    if (data.message && !chat.messages.some(m => m.id && m.id === data.message.id)) chat.messages.push(data.message);
    chat.streaming = false;
    chat.thoughts = '';
    chat.streamText = '';
    chat.hitl = null;
    chat.question = null;
    group.streaming = false;
    group.streamText = '';
    applyContext(data);
    if (inGroup && data.message?.content) {
      upsertGroupEvent({
        id: data.message.id,
        type: 'manager',
        content: data.message.content,
        timestamp: data.message.timestamp,
        vendorLabel: chat.vendorLabel || '',
        model: data.message.model || '',
      });
    }
  } else if (event === 'error') {
    chat.error = data.error || '对话失败';
    chat.streaming = false;
    if (inGroup) {
      group.error = data.error || '对话失败';
      group.streaming = false;
    }
  } else if (event === 'mode') {
    chat.mode = data.mode || chat.mode;
    group.mode = data.mode || group.mode;
  } else if (event === 'cleared') {
    chat.messages = [];
  } else if (event === 'done') {
    chat.streaming = false;
    group.streaming = false;
  }
  if (inGroup) patchGroup();
  else patchLog();
  patchCompose();
}

function applyContext(data) {
  if (data?.used == null && data?.window == null) return;
  const next = {
    used: data.used,
    window: data.window,
    remaining: data.remaining,
    ratio: data.ratio,
    shouldCompact: data.shouldCompact,
  };
  const inGroup = typeof document !== 'undefined' && Boolean(document.querySelector('[data-group-chat]'));
  if (inGroup) group.context = { ...(group.context || {}), ...next };
  else chat.context = { ...(chat.context || {}), ...next };
}

export function scrollChatToLatest() {
  if (typeof document === 'undefined') return;
  const pin = () => {
    document.querySelectorAll('#chat-log, #group-log').forEach(log => {
      log.scrollTop = log.scrollHeight;
    });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pin);
  else pin();
}

let streamFrame = 0;
let groupFrame = 0;
let pendingGroupId = '';

function paintStream() {
  streamFrame = 0;
  const el = document.querySelector('[data-stream-text]');
  if (el) el.textContent = chat.streamText;
  const th = document.querySelector('[data-stream-thoughts]');
  if (th) th.textContent = chat.thoughts;
  const gel = document.querySelector('[data-group-stream]');
  if (gel) gel.textContent = group.streamText;
  scrollChatToLatest();
}

function scheduleStreamPaint() {
  if (typeof requestAnimationFrame !== 'function') {
    paintStream();
    return;
  }
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(paintStream);
}

function patchLog() {
  if (typeof document === 'undefined') return;
  if (streamFrame) cancelAnimationFrame(streamFrame);
  streamFrame = 0;
  const log = document.querySelector('#chat-log');
  if (log) {
    const empty = !chat.messages.length && !chat.streaming ? '' : '';
    log.innerHTML = empty + chat.messages.map(renderMessage).join('') + (chat.streaming ? renderStreaming() : '');
  }
  const term = document.querySelector('.terminal-log');
  if (term && !chat.streaming) {
    const text = chatTerminalLog();
    term.innerHTML = text ? esc(text) : '<span class="terminal-placeholder">Agent 执行的命令会显示在这里。</span>';
    term.scrollTop = term.scrollHeight;
  }
  scrollChatToLatest();
  const hitlHost = document.querySelector('[data-chat-root]');
  if (hitlHost) {
    const old = hitlHost.querySelector('.hitl-card');
    const qold = hitlHost.querySelector('[data-question-form]');
    if (old) old.remove();
    if (qold) qold.remove();
    const compose = hitlHost.querySelector('.chat-compose');
    if (chat.hitl) compose?.insertAdjacentHTML('beforebegin', renderHitl(chat.hitl));
    if (chat.question) compose?.insertAdjacentHTML('beforebegin', renderQuestion(chat.question));
  }
}

export async function sendChat(api, { sessionId, partitionId, text }) {
  const inGroup = Boolean(document.querySelector('[data-group-chat]'));
  if (sessionId) chat.sessionId = sessionId;
  chat.draft = '';
  group.draft = '';
  chat.modeMenuOpen = false;
  const box = document.querySelector('[data-chat-form] textarea');
  if (box) { box.value = ''; box.disabled = true; }
  chat.streaming = true;
  chat.error = '';
  chat.hitl = null;
  chat.question = null;
  chat.thoughts = '';
  chat.streamText = '';
  if (inGroup) {
    group.streaming = true;
    group.error = '';
    group.streamText = '';
    patchGroup(sessionId);
  } else {
    patchLog();
  }
  patchCompose();
  try {
    const payload = { sessionId, partitionId: partitionId || undefined, text };
    if (chat.effort) payload.effort = chat.effort;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = '对话失败';
      try { message = (await response.json()).error || message; } catch { /* keep */ }
      chat.streaming = false;
      chat.error = message;
      if (inGroup) {
        group.streaming = false;
        group.error = message;
        patchGroup(sessionId);
      } else patchLog();
      throw new Error(message);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) parseSse(part);
    }
    if (buf.trim()) parseSse(buf);
    chat.streaming = false;
    group.streaming = false;
    if (document.querySelector('[data-group-chat]')) patchGroup(sessionId);
    else patchLog();
    patchCompose();
  } finally {
    if (box) box.disabled = false;
    patchCompose();
  }
}

function parseSse(part) {
  let event = 'message';
  let data = {};
  for (const line of part.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) {
      try { data = JSON.parse(line.slice(5).trim()); } catch { data = {}; }
    }
  }
  applyEvent(event, data);
}

const SHELL_TOOLS=/^(bash|exec_command|run_terminal_command|run_terminal_cmd|run_command|shell)$/i;

export function chatToolCards(){
  const out=[];
  for(const m of chat.messages){
    (m.toolCalls||[]).forEach((tc,i)=>{
      out.push({name:tc.name,args:tc.args||{},result:(m.toolResults||[])[i]||null});
    });
  }
  return out;
}

export function chatTerminalLog(){
  return chatToolCards().filter(t=>SHELL_TOOLS.test(String(t.name||''))).map(t=>{
    const cmd=t.args.command||t.args.cmd||t.args.script||t.name;
    const body=t.result?String(t.result.output||t.result.error||''):'';
    return `$ ${cmd}${body?`\n${body}`:''}`;
  }).join('\n\n');
}

export async function resolveHitl(api, id, approved, answers) {
  await api('chat/hitl', { approvalId: id, approved, answers });
  if (!answers) chat.hitl = null;
  else chat.question = null;
  patchLog();
}

export async function abortChat(api, sessionId, partitionId, extra = {}) {
  await api('chat/abort', {
    sessionId,
    partitionId: partitionId || undefined,
    scope: extra.scope || undefined,
  });
  chat.streaming = false;
  group.streaming = false;
  patchCompose();
  if (document.querySelector('[data-group-chat],[data-task-box]')) patchGroup(sessionId);
  else patchLog();
}
