import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applySessionEvent, chat, chatPanel, chatTerminalLog, chatToolCards, formatQuota, group, groupPanel, liveTasks, renderLiveBoard, renderTaskBox, resetChat, resetGroup, scrollChatToLatest } from '../public/chat.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('工作台两列：左栏项目、主工作区内容纳扩展；终端默认不占位可由快捷键和头部入口打开', () => {
  assert.match(app, /data-workbench/);
  assert.match(app, /workbench-body/);
  assert.match(app, /aria-label="工作区域"/);
  assert.match(app, /extension-pane/);
  assert.match(app, /aria-label="扩展区域"/);
  assert.match(app, /work-column/);
  assert.match(app, /work-column[\s\S]*terminalDock\(\)/);
  assert.match(app, /function terminalDock/);
  assert.match(app, /if\(!terminalOpen\)return ''/);
  assert.match(app, /terminal-dock/);
  assert.match(app, /header-actions[\s\S]*data-action="toggle-terminal"[\s\S]*data-action="toggle-extension"/);
  assert.match(app, /let terminalOpen=false/);
  assert.match(app, /e\.key==='`'/);
  assert.match(app, /e\.code==='Backquote'/);
  assert.match(app, /data-action="toggle-extension"/);
  assert.match(app, /extension-backdrop/);
  assert.match(app, /chat-content[\s\S]*extensionPane\(\)/);
  assert.match(app, /data-context-tasks/);
  assert.match(app, />分区</);
  assert.match(app, />工具</);
  assert.match(app, /扩展在主工作区内打开/);
  assert.doesNotMatch(app, />扩展</);
  assert.match(css, /\.extension-backdrop/);
  assert.match(css, /\.app\{[^}]*display:\s*grid/);
  assert.match(css, /grid-template-columns:272px minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /grid-template-columns:272px minmax\(0,1fr\) 280px/);
  assert.match(css, /\.work-column/);
  assert.match(css, /\.extension-pane/);
  assert.match(css, /\.chat-content\{[^}]*display:\s*flex/);
  assert.match(css, /\[data-context-tasks\]:empty\{display:none/);
  assert.match(css, /\.header-actions/);
  assert.match(css, /\.terminal-head/);
  assert.doesNotMatch(css, /\.sidebar\{[^}]*height:100vh/);
  assert.match(app, /data-action="project-menu"/);
  assert.match(app, /data-action="new-session"/);
  assert.match(app, /partitionsDirty/);
  assert.match(app, /chat\.streaming\|\|group\.streaming/);
});

test('终端日志只收集 shell 类工具输出，默认不把拉取模型写进去', () => {
  chat.messages = [{
    role: 'assistant',
    toolCalls: [
      { name: 'run_terminal_command', args: { command: 'dir' } },
      { name: 'read_file', args: { path: 'a.js' } },
    ],
    toolResults: [
      { output: 'AgentsGZT' },
      { output: 'not shell' },
    ],
  }];
  assert.equal(chatToolCards().length, 2);
  const log = chatTerminalLog();
  assert.match(log, /\$ dir/);
  assert.match(log, /AgentsGZT/);
  assert.doesNotMatch(log, /not shell/);
  chat.messages = [];
  assert.equal(chatTerminalLog(), '');
});

test('输入框按 Codex 样式，发送旁展示该 AI 的上下文额度', () => {
  resetChat();
  resetGroup();
  chat.context = { used: 24000, window: 200000 };
  chat.vendor = 'claude';
  chat.mode = 'bypassPermissions';
  const html = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true, projectPath: 'C:/proj' });
  assert.match(html, /随心输入/);
  assert.match(html, /compose-send/);
  assert.match(html, /compose-quota/);
  assert.match(html, /compose-quota-ring/);
  assert.match(html, /背景信息窗口/);
  assert.match(html, /12% 已用/);
  assert.match(html, /已用 24k 标记，共 200k/);
  assert.match(html, /完全访问/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-label="发送"/);
  assert.match(html, /compose-send" aria-label="发送" disabled/);
  assert.doesNotMatch(html, />发送</);
  chat.draft = '继续';
  const ready = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true });
  assert.doesNotMatch(ready, /compose-send" aria-label="发送" disabled/);
  chat.streaming = true;
  const running = chatPanel({ session: { id: 's1', name: '会话' }, partition: { id: 'p1', name: 'Grok' }, managerReady: true });
  assert.match(running, /compose-quota-ring/);
  assert.doesNotMatch(running, /is-idle/);
  assert.match(running, /is-stop/);
  assert.match(running, /aria-label="停止"/);
  group.context = { used: 180000, window: 200000 };
  group.vendor = 'claude';
  group.mode = 'bypassPermissions';
  group.streaming = true;
  const groupHtml = groupPanel({ session: { id: 's1', name: '会话' }, projectPath: 'C:/proj', managerReady: true });
  assert.match(groupHtml, /compose-send/);
  assert.match(groupHtml, /90% 已用/);
  assert.match(groupHtml, /已用 180k 标记，共 200k/);
  assert.match(groupHtml, /is-full/);
  assert.match(groupHtml, /is-stop/);
  assert.equal(formatQuota({ used: 900, window: 1000 }).level, 'full');
  assert.equal(formatQuota({ used: 24000, window: 200000 }).percent, 12);
  assert.match(css, /\.compose-send\.is-stop/);
  assert.match(css, /\.compose-quota-ring/);
  assert.match(css, /\.compose-quota-tip/);
  resetChat();
  resetGroup();
});

test('权限弹窗按厂家真实模式列出，不把 Codex 档套到 Claude', () => {
  resetChat();
  resetGroup();
  chat.vendor = 'codex';
  chat.mode = 'never';
  chat.modeMenuOpen = true;
  const codexHtml = chatPanel({ session: { id: 's1', name: '会话' }, partition: { id: 'p1', name: 'Codex' }, managerReady: true });
  assert.match(codexHtml, /应如何批准 ChatGPT 操作/);
  assert.match(codexHtml, /data-mode="on-request"/);
  assert.match(codexHtml, /data-mode="on-failure"/);
  assert.match(codexHtml, /data-mode="never"/);
  assert.match(codexHtml, /data-mode="untrusted"/);
  assert.match(codexHtml, /完全访问权限/);
  assert.doesNotMatch(codexHtml, /data-mode="bypassPermissions"/);
  assert.doesNotMatch(codexHtml, /data-mode="plan"/);
  chat.vendor = 'claude';
  chat.mode = 'plan';
  const claudeHtml = chatPanel({ session: { id: 's1', name: '会话' }, partition: { id: 'p1', name: 'Claude' }, managerReady: true });
  assert.match(claudeHtml, /应如何批准 Claude 操作/);
  assert.match(claudeHtml, /data-mode="acceptEdits"/);
  assert.match(claudeHtml, /data-mode="bypassPermissions"/);
  assert.doesNotMatch(claudeHtml, /data-mode="on-request"/);
  chat.vendor = 'agy';
  chat.mode = 'accept-edits';
  const agyHtml = chatPanel({ session: { id: 's1', name: '会话' }, partition: { id: 'p1', name: 'Gemini' }, managerReady: true });
  assert.match(agyHtml, /应如何批准 Gemini 操作/);
  assert.match(agyHtml, /data-mode="accept-edits"/);
  assert.match(agyHtml, /data-mode="bypassPermissions"/);
  assert.doesNotMatch(agyHtml, /data-mode="never"/);
  chat.vendor = 'grok';
  chat.mode = 'auto';
  const grokHtml = chatPanel({ session: { id: 's1', name: '会话' }, partition: { id: 'p1', name: 'Grok' }, managerReady: true });
  assert.match(grokHtml, /应如何批准 Grok 操作/);
  assert.match(grokHtml, /data-mode="dontAsk"/);
  assert.doesNotMatch(grokHtml, /data-mode="on-failure"/);
  assert.match(css, /\.compose-mode-menu/);
  resetChat();
  resetGroup();
});

test('压缩消息显示为备注，不把摘要原文当成用户气泡', () => {
  resetChat();
  chat.messages = [
    { role: 'user', kind: 'compaction', content: '[Compacted context]\nUNIQUE_SUMMARY' },
    { role: 'assistant', kind: 'compaction', content: 'Continuing from the compacted context of this same session.' },
    { role: 'user', content: '继续同一会话' },
  ];
  const html = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true, projectPath: 'C:/proj' });
  assert.match(html, /上下文压缩/);
  assert.match(html, /已到窗口 90%/);
  assert.match(html, /\/compact/);
  assert.doesNotMatch(html, /UNIQUE_SUMMARY/);
  assert.doesNotMatch(html, /Continuing from the compacted/);
  assert.match(html, /继续同一会话/);
  assert.match(css, /\.bubble\.compact/);
  resetChat();
});

test('执行间有任务箱和返回会话，群聊能渲染系统备注和全部停止', () => {
  resetGroup();
  group.events = [
    { id: 'n1', type: 'note', content: '用户直接向 Grok 下达了：改入口', partitionId: 'p1', source: 'user' },
    { id: 't1', type: 'task', taskId: 't1', kind: 'execution', status: 'running', name: 'Grok', vendorLabel: 'Grok', partitionId: 'p1', source: 'manager', summary: '改入口' },
    { id: 't2', type: 'task', taskId: 't2', kind: 'execution', status: 'running', name: 'Grok', partitionId: 'p1', source: 'user', summary: '你下的' },
  ];
  const exec = chatPanel({
    session: { id: 's1', name: '会话' },
    partition: { id: 'p1', name: 'Grok' },
    managerReady: true,
  });
  assert.match(exec, /back-to-group/);
  assert.doesNotMatch(exec, /data-task-box/);
  assert.doesNotMatch(exec, /任务箱/);
  const box = renderTaskBox('s1', 'p1', group.events.filter(e => e.type === 'task' && e.partitionId === 'p1'));
  assert.match(box, /data-task-box/);
  assert.match(box, /任务箱/);
  group.events.push({ id: 'm1', type: 'manager', content: '已派给 Codex', vendorLabel: 'Grok' });
  const board = groupPanel({ session: { id: 's1', name: '会话' }, projectPath: 'C:/proj', managerReady: true, managerLabel: 'Grok · grok-4.6' });
  assert.match(board, /Grok · grok-4\.6/);
  assert.match(board, /bubble-label">Grok</);
  assert.match(board, /已派给 Codex/);
  assert.match(board, /用户直接向 Grok 下达了/);
  assert.match(board, /data-scope="group"/);
  assert.match(board, /全部停止/);
  assert.match(board, /data-live-actions/);
  assert.match(board, /管理者派发/);
  assert.doesNotMatch(board, /data-group-board/);
  assert.doesNotMatch(board, /没有正在执行的任务/);
  assert.doesNotMatch(board, />你下的</);
  const live = renderLiveBoard('s1', liveTasks());
  assert.match(live, /data-group-board/);
  assert.match(live, /管理者派发/);
  assert.match(live, /你下达/);
  resetGroup();
  const empty = groupPanel({ session: { id: 's1', name: '会话' }, projectPath: 'C:/proj', managerReady: true });
  assert.equal(renderLiveBoard('s1', liveTasks()), '');
  assert.doesNotMatch(empty, /data-group-board/);
  assert.doesNotMatch(empty, /没有正在执行的任务/);
  assert.doesNotMatch(empty, /全部停止/);
  resetGroup();
});

test('工作区页签条、切换摘要和文件预览是主工作区页签，不是第三列', () => {
  assert.match(app, /function workspaceTabs/);
  assert.match(app, /function filePane/);
  assert.match(app, /data-action="workspace-tab"/);
  assert.match(app, /data-action="toggle-summary"/);
  assert.match(app, />切换摘要</);
  assert.match(app, /data-action="toggle-file-picker"/);
  assert.match(app, /data-action="session-menu"/);
  assert.match(app, /data-action="rename-session"/);
  assert.match(app, /data-action="open-file"/);
  assert.match(app, /data-action="close-file"/);
  assert.match(app, /data-file-page/);
  assert.match(app, /placeWorkspacePopovers/);
  assert.match(app, /filePickerDir=listed\.relative/);
  assert.match(app, /if\(workspaceTab!=='conversation'/);
  assert.match(app, /header-actions[\s\S]*data-action="toggle-summary"[\s\S]*data-action="toggle-terminal"[\s\S]*data-action="toggle-extension"/);
  assert.match(css, /\.workspace-tabs/);
  assert.match(css, /\.summary-popover/);
  assert.match(css, /\.file-page/);
  assert.match(css, /\.chat-status/);
  assert.match(css, /\.chat-main header\{[^}]*height:48px/);
  const chatJs = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(chatJs, /chat-head chat-status/);
  assert.match(chatJs, /data-action="open-file"/);
  assert.doesNotMatch(chatJs, /<h1>/);
  assert.doesNotMatch(app, /grid-template-columns:272px minmax\(0,1fr\) 280px/);
});

test('管理者 overlay 工具渲染成派发卡片而不是原始 JSON，切回对话会滚到最新', () => {
  const chatJs = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(app, /scrollChatToLatest\(\)/);
  assert.match(chatJs, /export function scrollChatToLatest/);
  assert.match(chatJs, /workbench_dispatch/);
  assert.match(chatJs, /正在派发/);
  assert.match(css, /chat-log:has\(\.bubble\)::before/);
  resetChat();
  chat.vendorLabel = 'Claude';
  chat.messages = [{
    role: 'assistant',
    content: '',
    toolCalls: [{ name: 'workbench_dispatch', args: { connectionId: 'Grok', prompt: '创建一个简单的循环文件' } }],
    toolResults: [{ output: JSON.stringify({ ok: true, status: 'running', taskId: 't1', partitionId: 'p1', name: 'Grok' }) }],
  }];
  const html = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true });
  assert.match(html, /创建一个简单的循环文件/);
  assert.match(html, /Grok/);
  assert.match(html, /管理者派发/);
  assert.match(html, /data-action="open-task"/);
  assert.match(html, /data-id="p1"/);
  assert.doesNotMatch(html, /"connectionId"/);
  assert.doesNotMatch(html, /workbench_dispatch/);
  resetGroup();
  group.events = [{ type: 'task', taskId: 't1', status: 'failed', name: 'Grok', vendorLabel: 'Grok', partitionId: 'p1', summary: '额度不足' }];
  const failed = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true });
  assert.match(failed, /失败/);
  assert.match(failed, /额度不足/);
  resetGroup();
  chat.messages = [{
    role: 'assistant',
    content: '',
    toolCalls: [{ name: 'workbench_list_targets', args: {} }],
    toolResults: [{ output: JSON.stringify({ ok: true, pool: [{ id: 'a' }, { id: 'b' }] }) }],
  }];
  const listed = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true });
  assert.match(listed, /已查看可派发目标/);
  assert.doesNotMatch(listed, /"pool"/);
  chat.messages = [{
    role: 'assistant',
    content: '',
    toolCalls: [{ name: 'workbench_spawn_clone', args: { prompt: '整理刚才的方案' } }],
    toolResults: [{ output: JSON.stringify({ ok: true, status: 'running', partitionId: 'c1', name: '分身' }) }],
  }];
  const clone = chatPanel({ session: { id: 's1', name: '会话' }, partition: null, managerReady: true });
  assert.match(clone, /整理刚才的方案/);
  assert.match(clone, /分身/);
  assert.doesNotMatch(clone, /"prompt"/);
  resetChat();
});

test('scrollChatToLatest 把对话日志钉在底部', () => {
  const chatLog = { scrollTop: 12, scrollHeight: 800 };
  const groupLog = { scrollTop: 0, scrollHeight: 640 };
  const previous = globalThis.document;
  globalThis.document = {
    querySelectorAll: (sel) => {
      if (sel.includes('chat-log')) return [chatLog, groupLog];
      return [];
    },
  };
  try {
    scrollChatToLatest();
    assert.equal(chatLog.scrollTop, 800);
    assert.equal(groupLog.scrollTop, 640);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('clone_result 只写入管理者视图，不写入执行会话', () => {
  resetChat();
  applySessionEvent('clone_result', { text: '分身摘要' }, { selectedPartition: 'exec-1', viewingManager: false });
  assert.equal(chat.messages.length, 0);
  applySessionEvent('clone_result', { text: '分身摘要' }, { selectedPartition: 'mgr-1', viewingManager: true });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].kind, 'clone_result');
  assert.equal(chat.messages[0].content, '分身摘要');
  resetChat();
});

test('dispatch_result 写入管理者视图，工人结果出现在群聊', () => {
  assert.match(app, /dispatch_result/);
  resetChat();
  applySessionEvent('dispatch_result', { text: '已写好循环文件', name: 'Grok', status: 'completed' }, { selectedPartition: 'exec-1', viewingManager: false });
  assert.equal(chat.messages.length, 0);
  applySessionEvent('dispatch_result', { text: '已写好循环文件', name: 'Grok', status: 'completed' }, { selectedPartition: 'mgr-1', viewingManager: true });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].kind, 'dispatch_result');
  const managerHtml = chatPanel({ session: { id: 's1' }, partition: null, managerReady: true });
  assert.match(managerHtml, /已写好循环文件/);
  assert.match(managerHtml, /Grok/);
  resetChat();
  resetGroup();
  group.events = [
    { type: 'user', content: 'Grok,写个循环' },
    { type: 'task', taskId: 't1', kind: 'execution', status: 'completed', name: 'Grok', vendorLabel: 'Grok', partitionId: 'p1', source: 'manager', content: '写个循环', summary: '已写好' },
    { type: 'worker', taskId: 't1', status: 'completed', name: 'Grok', vendorLabel: 'Grok', partitionId: 'p1', content: '已成功创建循环示例.py' },
  ];
  const groupHtml = groupPanel({ session: { id: 's1' }, projectPath: 'C:\\proj', managerReady: true });
  assert.match(groupHtml, /已成功创建循环示例\.py/);
  assert.match(groupHtml, /Grok · 完成/);
  resetGroup();
});
