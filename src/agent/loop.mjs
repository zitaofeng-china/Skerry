import * as agy from './agy.mjs';
import * as claude from './claude.mjs';
import * as grok from './grok.mjs';
import * as codex from './codex.mjs';
import * as custom from './custom.mjs';
import { decidePermission, normalizeMode, cycleMode, classifyRisk, planWritablePath, commandLineOf, isFullAccess } from './permissions.mjs';
import { loadSkills, loadRules } from './context.mjs';
import { formatToolResult, resolveWorkspacePath } from './workspace-io.mjs';
import { geminiTool, claudeTool, openaiTool, responsesTool, strProp, arg } from './stream.mjs';
import { appendMessage, publicTranscript, saveTranscript } from './store.mjs';
import { MODEL_GROUPS, connectionGroups } from '../../public/model-groups.js';
import { REASONING_LABELS } from '../../public/model-selection.js';
import {
  COMPACT_KIND,
  COMPACT_USER_PROMPT,
  DEFAULT_COMPACT_KEEP,
  compactTranscript,
  measureContext,
  resolveContextWindow,
  splitForCompact,
} from './compact.mjs';

const VENDORS = { agy, claude, grok, codex, custom };
const FAMILY_BY_GROUP = { claude: 'claude', codex: 'codex', gemini: 'agy', grok: 'grok' };

export function pickVendor(connection) {
  if (!connection) return 'custom';
  if (connection.id === 'official-gemini') return 'agy';
  if (connection.id === 'official-claude') return 'claude';
  if (connection.id === 'official-codex') return 'codex';
  if (connection.id === 'official-grok') return 'grok';
  return 'custom';
}

export function pickFamily(connection) {
  const vendor = pickVendor(connection);
  if (vendor !== 'custom') return vendor;
  const group = connectionGroups(connection || {})[0];
  return FAMILY_BY_GROUP[group] || 'custom';
}

export function vendorLabel(vendor) {
  return { agy: 'Antigravity', claude: 'Claude Code', grok: 'Grok', codex: 'Codex', custom: '自定义' }[vendor] || vendor;
}

export function groupLabel(connection) {
  const group = connectionGroups(connection || {})[0];
  const named = MODEL_GROUPS.find(g => g.id === group);
  if (named) return named.name;
  return vendorLabel(pickVendor(connection));
}

const SERIES_BY_FAMILY = { agy: 'Gemini', claude: 'Claude', grok: 'Grok', codex: 'Codex' };

export function managerActorIdentity(ctx = {}) {
  const family = ctx.toolFamily
    || (ctx.connection ? pickFamily(ctx.connection) : '')
    || ctx.vendor
    || '';
  const labeled = groupLabel(ctx.connection || {});
  const series = (labeled && labeled !== vendorLabel('custom'))
    ? labeled
    : (SERIES_BY_FAMILY[family] || labeled || '管理者');
  const model = String(ctx.model || '').trim();
  const effort = String(ctx.effort || '').trim();
  const effortLabel = effort ? (REASONING_LABELS[effort] || effort) : '';
  const actor = [series, model, effortLabel].filter(Boolean).join(' · ');
  return { series, model, effort, effortLabel, actor, family };
}

function toolVendor(ctx) {
  const family = ctx.toolFamily || pickFamily(ctx.connection);
  if (family && family !== 'custom') return family;
  return ctx.vendor || 'custom';
}

function adapter(vendor) {
  return VENDORS[vendor] || custom;
}

function overlayShape(vendor, protocol) {
  if (vendor === 'agy') return 'gemini';
  if (vendor === 'claude') return 'claude';
  if (vendor === 'codex') return 'responses';
  if (vendor === 'custom' && protocol === 'anthropic') return 'claude';
  if (vendor === 'custom' && protocol === 'responses') return 'responses';
  return 'openai';
}

function overlayTool(shape, name, description, properties, required = []) {
  if (shape === 'gemini') return geminiTool(name, description, properties, required);
  if (shape === 'claude') return claudeTool(name, description, properties, required);
  if (shape === 'responses') return responsesTool(name, description, properties, required);
  return openaiTool(name, description, properties, required);
}

function toolParts(tool) {
  if (!tool) return null;
  if (tool.function) {
    return {
      name: tool.function.name,
      description: tool.function.description || '',
      properties: tool.function.parameters?.properties || {},
      required: tool.function.parameters?.required || [],
    };
  }
  const schema = tool.input_schema || tool.parameters || {};
  return {
    name: tool.name,
    description: tool.description || '',
    properties: schema.properties || {},
    required: schema.required || [],
  };
}

export function familyToolsFor(family, shape) {
  if (!family || family === 'custom') return [];
  const native = adapter(family).tools?.() || [];
  return native.map(tool => {
    const parts = toolParts(tool);
    if (!parts?.name) return null;
    return overlayTool(shape, parts.name, parts.description, parts.properties, parts.required);
  }).filter(Boolean);
}

function overlayTools(vendor, protocol) {
  const shape = overlayShape(vendor, protocol);
  const listDesc = 'List capability pool, existing execution sessions, and manager clone slots. Manager overlay only.';
  const dispatchDesc = 'Send work to an execution session. Same product as the manager is still execution, not a clone. connectionId may be the pool id, connection name, or product label (Grok/Codex/Claude/Gemini). Returns immediately with running status.';
  const dispatchProps = {
    connectionId: strProp('Capability pool connection id, name, or product label'),
    partitionId: strProp('Existing execution partition id'),
    model: strProp('Optional model id'),
    prompt: strProp('Task for that execution session'),
  };
  const cloneDesc = 'Offload the manager\'s own long planning/research/summarizing to a clone. Max 2. Never use for user coding tasks. Clones cannot dispatch.';
  return [
    overlayTool(shape, 'workbench_list_targets', listDesc, {}),
    overlayTool(shape, 'workbench_dispatch', dispatchDesc, dispatchProps, ['prompt']),
    overlayTool(shape, 'workbench_spawn_clone', cloneDesc, { prompt: strProp('Work the manager clone should do') }, ['prompt']),
  ];
}

function overlaySystem(ctx) {
  const identity = managerActorIdentity(ctx);
  const pool = ctx.pool || [];
  const executions = ctx.partitions || [];
  const clones = ctx.cloneStatus || { running: 0, max: 2 };
  const poolLines = pool.length
    ? pool.map(p => `- ${p.connectionId} · series ${p.groupLabel || p.vendorLabel || p.vendor} · ${p.name} · model ${p.model || '(default)'}`).join('\n')
    : '(none configured)';
  const execLines = executions.length
    ? executions.map(p => `- ${p.id} · ${p.name}`).join('\n')
    : '(none yet; dispatch will create one)';
  const effortBit = identity.effort
    ? ` Effort: ${identity.effort} (${identity.effortLabel}).`
    : '';
  return [
    'You are the workbench manager AI. The user talks to you in group chat.',
    `You currently ARE ${identity.series}. Current model id: ${identity.model || '(unset)'}.${effortBit} Actor line: ${identity.actor || identity.series}.`,
    'If asked who you are or what model you are using, answer with this current series and model id only.',
    'Prior transcript turns may belong to a previous manager actor after a switch; do not inherit that series or model id.',
    'You have no coding, file, or shell tools. Do not impersonate another product\'s tools.',
    'Identity is the model series (Claude, Codex, Gemini, Grok), not the connection nickname. A custom provider in the Claude group is Claude-family, not a separate product.',
    'The capability pool lists dispatch targets. They are other workers, not you. Never claim a pool entry\'s model as your own.',
    'Chat and short answers that do not name a worker: reply yourself.',
    'If the user names a series or worker (Claude, Codex, Gemini, Grok, or a connection name) or asks you to 派/调用/dispatch/分身, you MUST call workbench_dispatch or workbench_spawn_clone in this same turn. A greeting or tiny test still counts when they named a worker. Do not only talk about dispatching.',
    'Real work (edit files, run commands, implement): workbench_dispatch. Dispatching to your own series MUST be workbench_dispatch, never a clone. That execution worker gets the series tools.',
    'workbench_spawn_clone is only to offload YOUR long planning/research/summarizing so you can keep talking. Max 2 clones, usually unused. Clones cannot dispatch. User tasks are never clones.',
    'After a tool result, tell the user you sent the work. Do not wait. Do not redo the worker\'s job. The worker\'s result or error later appears in group chat and the manager transcript; you will not get it as another tool result.',
    `Capability pool:\n${poolLines}`,
    `Execution sessions:\n${execLines}`,
    `Clone slots in use: ${clones.running}/${clones.max}`,
  ].join('\n');
}

function cloneNote(ctx) {
  const identity = managerActorIdentity(ctx);
  const who = identity.actor || identity.series;
  return `You are a manager clone (分身) of ${who}. Do the manager's long research, planning, or summarizing. You cannot dispatch or open execution sessions. Return a concise result. It will appear inside the manager AI, not as another worker.`;
}

function applySlash(text, transcript, vendor) {
  const raw = String(text || '');
  const match = raw.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { text: raw, slash: '' };
  const cmd = match[1].toLowerCase();
  const rest = (match[2] || '').trim();
  if (cmd === 'clear' || cmd === 'new') {
    transcript.messages = [];
    return { text: rest, slash: cmd, cleared: true };
  }
  if (cmd === 'plan') {
    transcript.mode = vendor === 'codex' ? transcript.mode : (vendor === 'agy' ? 'plan' : 'plan');
    return { text: rest || 'Create an implementation plan before any edits.', slash: 'plan' };
  }
  if (cmd === 'fast') return { text: rest, slash: 'fast' };
  if (cmd === 'compact') return { text: '', slash: 'compact', keepNote: rest };
  return { text: raw, slash: '' };
}

function toolPathOf(args = {}) {
  return String(args.file_path || args.TargetFile || args.target_file || args.path || args.DirectoryPath || args.workdir || args.cwd || '').trim();
}

function toolOutside(ctx, args, kind) {
  if (kind === 'net' || kind === 'ask' || kind === 'none') return false;
  const raw = toolPathOf(args);
  if (!raw) return false;
  try {
    return resolveWorkspacePath(ctx.workspace, raw, { allowOutside: true }).outside;
  } catch {
    return false;
  }
}

async function approve(ctx, name, args, kind) {
  const vendor = toolVendor(ctx);
  const outside = toolOutside(ctx, args, kind);
  const command = kind === 'exec' ? commandLineOf(args) : '';
  let decision = decidePermission({
    vendor,
    mode: ctx.transcript.mode,
    kind,
    outsideWorkspace: outside,
    extraAuthorized: Boolean(ctx.allowOutside) || isFullAccess(vendor, ctx.transcript.mode),
    planLocked: ctx.transcript.mode === 'plan' && !planWritablePath(vendor, JSON.stringify(args || {})),
    command,
  });
  if (ctx.transcript.mode === 'plan' && kind === 'write' && planWritablePath(vendor, args?.file_path || args?.TargetFile || args?.path || '')) {
    decision = { action: 'allow' };
  }
  if (decision.action === 'allow') return { approved: true, autoApproved: true, extraAuthorized: Boolean(ctx.allowOutside) };
  if (decision.action === 'deny') return { approved: false, reason: decision.reason || '当前模式拒绝该工具' };
  const summary = adapter(vendor).summarize?.(name, args) || `调用 ${name}`;
  const approval = ctx.hitl
    ? await ctx.hitl.request({
      sessionId: ctx.sessionId,
      targetId: ctx.targetId,
      vendor: ctx.vendor,
      toolName: name,
      args,
      summary,
      riskLevel: classifyRisk(kind, decision.commandRisk),
      kind,
      outsideWorkspace: outside,
      commandRisk: decision.commandRisk || null,
    })
    : { approved: false, reason: '无 HITL 通道' };
  if (approval.approved && outside) ctx.allowOutside = true;
  ctx.emit?.('hitl_resolved', { toolName: name, approved: approval.approved, reason: approval.reason || '' });
  return approval;
}

async function runTool(ctx, tc) {
  const name = tc.name;
  const args = tc.args || {};
  if (name === 'workbench_list_targets' || name === 'workbench_list_partitions') {
    if (ctx.listTargets) return ctx.listTargets();
    return {
      ok: true,
      pool: ctx.pool || [],
      executions: (ctx.partitions || []).map(p => ({ id: p.id, name: p.name, key: p.key, routes: p.routes })),
      clones: ctx.cloneStatus || { running: 0, max: 2 },
    };
  }
  if (name === 'workbench_dispatch') {
    if (!ctx.dispatchWork) return { ok: false, error: 'Dispatch unavailable' };
    return ctx.dispatchWork({
      connectionId: args.connectionId || args.ConnectionId || '',
      partitionId: args.partitionId || args.PartitionId || '',
      model: args.model || args.Model || '',
      prompt: args.prompt || args.Prompt || '',
    });
  }
  if (name === 'workbench_spawn_clone') {
    if (!ctx.spawnClone) return { ok: false, error: 'Clone unavailable' };
    return ctx.spawnClone({ prompt: args.prompt || args.Prompt || '' });
  }
  if (name === 'apply_patch' && !arg(args, 'input', 'patch')) {
    return { ok: false, error: 'apply_patch 缺少补丁内容' };
  }
  if (name === 'exec_command' && !arg(args, 'cmd', 'command')) {
    return { ok: false, error: 'Missing command' };
  }
  const vendor = toolVendor(ctx);
  const kind = adapter(vendor).RISK?.[name] || 'ask';
  if (name === 'ask_question' || name === 'AskUserQuestion' || name === 'ask_user_question' || name === 'request_user_input') {
    const questions = args.questions || [];
    ctx.emit?.('question', { id: tc.id, questions, vendor });
    const answer = ctx.hitl
      ? await ctx.hitl.request({
        sessionId: ctx.sessionId,
        targetId: ctx.targetId,
        vendor: ctx.vendor,
        toolName: name,
        args,
        summary: '模型向你提问',
        kind: 'ask',
      })
      : { approved: false, reason: '未回答' };
    return { ok: Boolean(answer.approved || answer.answers), answers: answer.answers, reason: answer.reason };
  }
  if (name === 'ExitPlanMode' || name === 'exit_plan_mode') {
    const approval = await approve(ctx, name, args, 'ask');
    if (!approval.approved) return { ok: false, error: approval.reason || '计划未批准' };
    ctx.transcript.mode = normalizeMode(vendor, 'default');
    ctx.transcript.plan = args.plan || ctx.transcript.plan;
    return { ok: true, mode: ctx.transcript.mode, plan: ctx.transcript.plan };
  }
  const approval = await approve(ctx, name, args, kind);
  if (!approval.approved) return { ok: false, error: approval.reason || '用户拒绝', approved: false };
  ctx.emit?.('tool_executing', { toolName: name, args, id: tc.id });
  const result = await adapter(vendor).execute(name, args, ctx);
  if (result?.leavePlan && result.needsUser) {
    const planOk = await approve(ctx, name, args, 'ask');
    if (planOk.approved) ctx.transcript.mode = normalizeMode(vendor, 'default');
  }
  return result;
}

export async function runTurn(ctx) {
  const impl = adapter(ctx.vendor);
  ctx.toolFamily = ctx.toolFamily || pickFamily(ctx.connection);
  const family = toolVendor(ctx);
  ctx.skills = ctx.skills || loadSkills(family, ctx.workspace);
  ctx.rules = ctx.rules || loadRules(family, ctx.workspace);
  ctx.transcript.mode = normalizeMode(family, ctx.transcript.mode);
  ctx.managerIdle = Boolean(ctx.isManager && !ctx.isClone);
  ctx.extraTools = ctx.managerIdle ? overlayTools(ctx.vendor, ctx.protocol) : [];
  ctx.familyTools = (!ctx.managerIdle && ctx.vendor === 'custom')
    ? familyToolsFor(ctx.toolFamily, overlayShape(ctx.vendor, ctx.protocol))
    : [];
  ctx.managerNote = ctx.managerIdle ? overlaySystem(ctx) : (ctx.isClone ? cloneNote(ctx) : '');
  ctx.measureContext = () => contextSnapshot(ctx);
  ctx.childAgents = ctx.childAgents || [];
  ctx.runSubagent = async ({ prompt, typeName, description }) => {
    if ((ctx.depth || 0) >= 2) return { ok: false, error: 'Subagent nesting limit' };
    const childMessages = [];
    appendMessage({ messages: childMessages }, { role: 'user', content: prompt });
    const childCtx = {
      ...ctx,
      depth: (ctx.depth || 0) + 1,
      isManager: false,
      extraTools: [],
      transcript: { ...ctx.transcript, messages: childMessages, mode: typeName === 'explore' || typeName === 'research' || typeName === 'plan' ? 'plan' : ctx.transcript.mode },
    };
    ctx.emit?.('subagent_start', { typeName, description, prompt: String(prompt).slice(0, 200) });
    const result = await runLoop(childCtx);
    ctx.emit?.('subagent_done', { typeName, text: String(result.text || '').slice(0, 4000) });
    return { ok: true, typeName, text: result.text };
  };

  const userText = ctx.userText;
  const slashed = applySlash(userText, ctx.transcript, family);
  if (slashed.cleared) ctx.emit?.('cleared', {});
  if (slashed.slash === 'plan') ctx.emit?.('mode', { mode: ctx.transcript.mode });
  if (slashed.slash === 'compact') {
    const compact = await runCompactCommand(ctx, { force: true, keepNote: slashed.keepNote, reason: 'command' });
    persist(ctx);
    const text = compact.compacted ? '已执行 /compact，同一会话继续。' : '当前上下文无需压缩。';
    ctx.emit?.('agent_done', {
      message: compact.compacted ? null : { role: 'assistant', content: text },
      turns: 0,
      vendor: ctx.vendor,
    });
    return { text, turns: 0, compacted: compact.compacted };
  }
  if (slashed.text) {
    const userMsg = appendMessage(ctx.transcript, { role: 'user', content: slashed.text });
    persist(ctx);
    ctx.emit?.('user_message', userMsg);
  } else {
    persist(ctx);
    ctx.emit?.('agent_done', { message: { role: 'assistant', content: slashed.cleared ? '已清空会话。' : '' }, turns: 0, vendor: ctx.vendor });
    return { text: slashed.cleared ? '已清空会话。' : '', turns: 0 };
  }

  await maybeCompact(ctx);

  try {
    return await runLoop(ctx);
  } catch (error) {
    persist(ctx);
    throw error;
  }
}

async function runLoop(ctx) {
  const impl = adapter(ctx.vendor);
  const maxTurns = ctx.maxTurns || 24;
  let finalText = '';
  let thoughts = '';
  let turns = 0;
  const executed = [];

  while (turns < maxTurns) {
    turns += 1;
    ctx.emit?.('turn_start', { turn: turns, vendor: ctx.vendor, model: ctx.model });
    if (turns > 1) await maybeCompact(ctx);
    let turnText = '';
    let turnThoughts = '';
    const turnCalls = [];
    const result = await impl.stream(ctx, {
      messages: ctx.transcript.messages,
      onText: chunk => { turnText += chunk; finalText += chunk; ctx.emit?.('text_delta', { delta: chunk }); },
      onThought: chunk => { turnThoughts += chunk; thoughts += chunk; ctx.emit?.('thought_delta', { delta: chunk }); },
      onToolCall: tc => { turnCalls.push(tc); ctx.emit?.('tool_call', tc); },
    });
    for (const tc of result.toolCalls || []) {
      if (!turnCalls.some(t => t.id === tc.id)) turnCalls.push(tc);
    }
    if (!turnText && result.text) {
      turnText = result.text;
      finalText += result.text;
    }
    if (!turnThoughts && result.thoughts) turnThoughts = result.thoughts;

    if (!turnCalls.length) {
      const assistantMsg = appendMessage(ctx.transcript, {
        role: 'assistant',
        content: turnText || result.text || '',
        thoughts: turnThoughts || result.thoughts || '',
        model: ctx.model,
        requestModel: ctx.model,
        effort: ctx.effort || '',
      });
      persist(ctx);
      emitDone(ctx, { message: assistantMsg, turns });
      return { text: assistantMsg.content, thoughts: assistantMsg.thoughts, turns, message: assistantMsg };
    }

    const toolResults = [];
    for (const tc of turnCalls) {
      let output;
      try {
        output = await runTool(ctx, tc);
      } catch (error) {
        output = { ok: false, error: error.message };
      }
      const packed = {
        toolCallId: tc.id,
        toolName: tc.name,
        output: formatToolResult(output),
        error: output?.ok === false ? (output.error || 'failed') : '',
      };
      toolResults.push(packed);
      executed.push(packed);
      ctx.emit?.('tool_result', packed);
    }
    appendMessage(ctx.transcript, {
      role: 'assistant',
      content: turnText,
      thoughts: turnThoughts,
      toolCalls: turnCalls,
      toolResults,
      model: ctx.model,
    });
    persist(ctx);
  }

  const assistantMsg = appendMessage(ctx.transcript, {
    role: 'assistant',
    content: finalText || '已达到本轮工具循环上限。',
    thoughts,
    model: ctx.model,
    finishReason: 'max_turns',
  });
  persist(ctx);
  emitDone(ctx, { message: assistantMsg, turns });
  return { text: assistantMsg.content, thoughts, turns, message: assistantMsg };
}

function persist(ctx) {
  if (ctx.dataDir && ctx.sessionId && ctx.targetId) {
    saveTranscript(ctx.dataDir, ctx.sessionId, ctx.targetId, ctx.transcript);
  }
}

function emitDone(ctx, extra = {}) {
  const snap = contextSnapshot(ctx);
  ctx.emit?.('agent_done', {
    vendor: ctx.vendor,
    used: snap.used,
    window: snap.window,
    remaining: snap.remaining,
    ratio: snap.ratio,
    shouldCompact: snap.shouldCompact,
    ...extra,
  });
}

function snapshotTools(ctx) {
  if (ctx.managerIdle) return ctx.extraTools || [];
  if (ctx.vendor === 'custom') return ctx.familyTools || [];
  return adapter(ctx.vendor).tools?.() || [];
}

function contextSnapshot(ctx, messages = ctx.transcript?.messages) {
  const impl = adapter(ctx.vendor);
  return measureContext({
    messages: messages || [],
    system: impl.systemPrompt?.(ctx) || '',
    tools: snapshotTools(ctx),
    window: resolveContextWindow(ctx),
  });
}

async function runCompactCommand(ctx, { force = false, keepNote = '', reason = 'threshold' } = {}) {
  if (ctx.compacting || ctx.compactedThisTurn) return { compacted: false, skipped: true };
  const before = contextSnapshot(ctx);
  if (!force && !before.shouldCompact) return { compacted: false, ...before };
  const { older } = splitForCompact(ctx.transcript.messages);
  const meaningful = older.filter(m => m?.kind !== COMPACT_KIND);
  if (!meaningful.length) return { compacted: false, ...before };

  ctx.compacting = true;
  ctx.emit?.('compacting', { reason, used: before.used, window: before.window });
  let summary = '';
  try {
    const impl = adapter(ctx.vendor);
    const shadow = {
      ...ctx,
      compacting: true,
      compactKeepNote: keepNote || DEFAULT_COMPACT_KEEP,
      extraTools: [],
      familyTools: [],
      managerNote: '',
    };
    const compactMessages = [...older];
    if (compactMessages.at(-1)?.role === 'user') {
      compactMessages.push({ role: 'assistant', content: 'Ready to compact.' });
    }
    compactMessages.push({ role: 'user', content: COMPACT_USER_PROMPT });
    const result = await impl.stream(shadow, {
      messages: compactMessages,
      onText() {},
      onThought() {},
      onToolCall() {},
    });
    summary = String(result?.text || '').trim();
  } catch {
    summary = '';
  } finally {
    ctx.compacting = false;
  }

  const result = compactTranscript(ctx.transcript, { summary: summary || undefined, reason });
  if (!result.compacted) return { compacted: false, ...before };
  ctx.compactedThisTurn = true;
  persist(ctx);
  const after = contextSnapshot(ctx);
  ctx.emit?.('compacted', {
    dropped: result.dropped,
    kept: result.kept,
    used: after.used,
    window: after.window,
    compactCount: result.compactCount,
    reason,
    messages: publicTranscript(ctx.transcript).messages,
  });
  return { ...result, ...after };
}

async function maybeCompact(ctx) {
  return runCompactCommand(ctx, { force: false, reason: 'threshold', keepNote: DEFAULT_COMPACT_KEEP });
}

export { cycleMode };
