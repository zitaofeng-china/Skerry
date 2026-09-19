import { CODEX_RESPONSES_URL, CODEX_CLI_VERSION } from '../model-fetch.mjs';
import { CODEX_CLI_ORIGINATOR, CODEX_CLI_USER_AGENT } from '../official-client-http.mjs';
import { applyRequestTimezone, applyResponseTimezone } from '../session-timezone.mjs';
import { consumeSse, boundTools, responsesTool, strProp, intProp, arrProp, objProp, arg, responsesCallBag } from './stream.mjs';
import {
  readWorkspaceFile, runWorkspaceCommand, listBackgroundTasks, writeTaskStdin, killBackgroundTask,
  fetchUrlText,
} from './workspace-io.mjs';
import { applyPatch } from './patch.mjs';
import { environmentBlock, skillCatalogText } from './context.mjs';
import { compactSystemPrompt } from './compact.mjs';

export const VENDOR = 'codex';

export const RISK = {
  exec_command: 'exec',
  write_stdin: 'exec',
  apply_patch: 'write',
  update_plan: 'none',
  view_image: 'read',
  current_time: 'read',
  get_context_remaining: 'read',
  new_context_window: 'none',
  sleep: 'none',
  request_user_input: 'ask',
  spawn_agent: 'ask',
  send_input: 'none',
  resume_agent: 'none',
  wait_agent: 'read',
  close_agent: 'none',
  skill_search: 'read',
  web_search: 'net',
};

export function tools() {
  return [
    responsesTool('exec_command', 'Run a command in a PTY. Required cmd. If still running, returns session_id; then use write_stdin.', {
      cmd: strProp('Command'),
      workdir: strProp('Working directory'),
      login: { type: 'BOOLEAN', description: 'Login shell' },
      yield_time_ms: intProp('Return session_id if still running after this many ms'),
      max_output_tokens: intProp('Output cap'),
      sandbox_permissions: strProp('require_escalated to ask for more'),
    }, ['cmd']),
    responsesTool('write_stdin', 'Write stdin to an exec session or poll with empty input.', {
      session_id: strProp('PTY session id'),
      chars: strProp('Bytes to write; omit or empty to poll'),
      yield_time_ms: intProp('Wait before returning'),
    }, ['session_id']),
    {
      type: 'function',
      name: 'apply_patch',
      description: 'Apply a Codex patch. Prefer this over echoing file contents. Patch language: *** Begin Patch / *** Add File: path / *** Update File: path / *** Delete File: path / *** End Patch. Hunk lines use + / - / space. This workbench intercepts the tool; it is not a PATH binary.',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Full apply_patch document' },
          patch: { type: 'string', description: 'Alias of input' },
        },
      },
    },
    responsesTool('update_plan', 'Step list. At most one in_progress.', {
      explanation: strProp('Why the plan changed'),
      plan: arrProp('Steps', objProp('step', {
        step: strProp('Text'),
        status: strProp('pending | in_progress | completed'),
      }, ['step', 'status'])),
    }, ['plan']),
    responsesTool('view_image', 'Attach a local image path to this turn.', { path: strProp('Image path') }, ['path']),
    responsesTool('current_time', 'Current time.', {}),
    responsesTool('get_context_remaining', 'Remaining context.', {}),
    responsesTool('new_context_window', 'Start a fresh context window without summarizing.', {}),
    responsesTool('sleep', 'Sleep milliseconds.', { duration_ms: intProp('Milliseconds') }, ['duration_ms']),
    responsesTool('request_user_input', '1–3 multiple-choice questions.', {
      questions: arrProp('Questions', objProp('q', {
        question: strProp('Question'),
        options: arrProp('Options', objProp('opt', { label: strProp('Label'), description: strProp('Meaning') }, ['label'])),
      }, ['question', 'options'])),
    }, ['questions']),
    responsesTool('spawn_agent', 'Spawn a subagent (multi_agent v1).', {
      prompt: strProp('Task'),
      name: strProp('Name'),
    }, ['prompt']),
    responsesTool('send_input', 'Message an existing agent.', {
      agent_id: strProp('Id'),
      message: strProp('Message'),
    }, ['agent_id', 'message']),
    responsesTool('resume_agent', 'Resume a closed agent.', { agent_id: strProp('Id') }, ['agent_id']),
    responsesTool('wait_agent', 'Wait for agents.', {
      agent_ids: arrProp('Ids', { type: 'STRING' }),
      timeout_ms: intProp('Timeout'),
    }),
    responsesTool('close_agent', 'Close an agent and descendants.', { agent_id: strProp('Id') }, ['agent_id']),
    responsesTool('skill_search', 'Search discovered skills.', { query: strProp('Keywords') }, ['query']),
  ];
}

export function systemPrompt(ctx) {
  if (ctx.compacting) return compactSystemPrompt(ctx.compactKeepNote);
  if (ctx.managerIdle) {
    return [ctx.managerNote || '', environmentBlock(ctx)].filter(Boolean).join('\n\n');
  }
  return [
    'You are Codex CLI running inside the Agents workbench on the Responses API.',
    'Default execution tools are exec_command + write_stdin (unified_exec). Do not call legacy shell or shell_command.',
    'Edit files with apply_patch, not a generic search_replace.',
    `Sandbox: workspace-write. Approval policy: ${ctx.mode}.`,
    ctx.managerNote || '',
    environmentBlock(ctx),
    ctx.rules?.length ? `<environment_context>\n${ctx.rules.map(r => r.text).join('\n\n')}\n</environment_context>` : '',
    `Skills:\n${skillCatalogText(ctx.skills || [])}`,
  ].filter(Boolean).join('\n\n');
}

export function toInput(messages) {
  const input = [];
  for (const m of messages) {
    if (m.role === 'user') {
      input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.content || '' }] });
      continue;
    }
    if (m.role !== 'assistant') continue;
    if (m.content) input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
    for (const tc of m.toolCalls || []) {
      input.push({
        type: 'function_call',
        call_id: tc.id,
        name: tc.name,
        arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
      });
    }
    for (const tr of m.toolResults || []) {
      input.push({
        type: 'function_call_output',
        call_id: tr.toolCallId,
        output: String(tr.output || tr.error || ''),
      });
    }
  }
  return input;
}

export async function stream(ctx, { messages, onText, onThought, onToolCall }) {
  const payload = {
    model: ctx.model,
    instructions: systemPrompt(ctx),
    input: toInput(messages),
    store: false,
    stream: true,
    ...(ctx.compacting ? {} : { tools: boundTools(ctx, tools()) }),
  };
  if (ctx.effort) payload.reasoning = { effort: ctx.effort };
  const body = JSON.stringify(applyRequestTimezone(payload, ctx.timezone));
  const response = await ctx.fetcher(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'text/event-stream',
      Originator: CODEX_CLI_ORIGINATOR,
      'User-Agent': CODEX_CLI_USER_AGENT,
      version: CODEX_CLI_VERSION,
      'chatgpt-account-id': ctx.accountID,
      Session_id: crypto.randomUUID(),
      'Content-Type': 'application/json',
    },
    body,
    signal: ctx.abortSignal || AbortSignal.timeout(180000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`官方模型请求失败：HTTP ${response.status} ${(await response.text()).slice(0, 240)}`);
  let text = '';
  let thoughts = '';
  const bag = responsesCallBag();
  await consumeSse(response, event => {
    const zoned = applyResponseTimezone(event, ctx.timezone);
    const type = zoned.type;
    if (type === 'response.output_text.delta' && typeof zoned.delta === 'string') {
      text += zoned.delta;
      onText?.(zoned.delta);
      return;
    }
    if (type === 'response.reasoning_text.delta' && typeof zoned.delta === 'string') {
      thoughts += zoned.delta;
      onThought?.(zoned.delta);
      return;
    }
    if (type === 'response.output_item.done' || type === 'response.output_item.added') {
      const item = zoned.item || {};
      bag.takeItem(item, zoned.output_index);
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text' && part.text && !text.includes(part.text)) {
            text += part.text;
            onText?.(part.text);
          }
        }
      }
      return;
    }
    if (bag.ingest(zoned)) return;
    if (!type && Array.isArray(zoned.output)) {
      for (const item of zoned.output) bag.takeItem(item);
    }
  });
  const toolCalls = bag.flush();
  for (const tc of toolCalls) onToolCall?.(tc);
  return { text, thoughts, toolCalls };
}

export async function execute(name, args, ctx) {
  const a = args || {};
  const allowOutside = ctx.allowOutside;
  switch (name) {
    case 'exec_command':
      return runWorkspaceCommand(ctx.workspace, arg(a, 'cmd', 'command'), {
        cwd: a.workdir,
        waitMsBeforeAsync: Number(a.yield_time_ms) || 15000,
        timeoutMs: 0,
        allowOutside,
        abortSignal: ctx.abortSignal,
      });
    case 'write_stdin': {
      if (a.chars) return writeTaskStdin(a.session_id, a.chars);
      const task = listBackgroundTasks(ctx.workspace).find(t => t.id === a.session_id);
      return task || { ok: false, error: 'Unknown session_id' };
    }
    case 'apply_patch': {
      const patch = arg(a, 'input', 'patch') || (typeof a === 'string' ? a : '');
      return applyPatch(ctx.workspace, patch, { allowOutside });
    }
    case 'update_plan':
      ctx.transcript.plan = JSON.stringify(a.plan || [], null, 2);
      ctx.transcript.todos = (a.plan || []).map((step, i) => ({
        id: String(i + 1),
        content: step.step,
        status: step.status,
      }));
      return { ok: true, plan: a.plan };
    case 'view_image':
      return readWorkspaceFile(ctx.workspace, a.path, { allowOutside });
    case 'current_time':
      return { ok: true, time: new Date().toISOString(), timezone: ctx.timezone };
    case 'get_context_remaining': {
      const snap = ctx.measureContext?.() || { messages: ctx.transcript.messages.length };
      return { ok: true, ...snap, messages: ctx.transcript.messages.length };
    }
    case 'new_context_window':
      ctx.transcript.messages = [];
      return { ok: true, reset: true };
    case 'sleep':
      await new Promise(r => setTimeout(r, Math.min(Number(a.duration_ms) || 0, 30000)));
      return { ok: true };
    case 'request_user_input':
      return { ok: true, questions: a.questions, needsUser: true };
    case 'spawn_agent':
      if (!ctx.runSubagent) return { ok: false, error: 'Subagent runner unavailable' };
      return ctx.runSubagent({ prompt: a.prompt, typeName: a.name || 'agent' });
    case 'send_input':
    case 'resume_agent':
    case 'wait_agent':
    case 'close_agent':
      return { ok: true, agents: ctx.childAgents || [] };
    case 'skill_search': {
      const q = String(a.query || '').toLowerCase();
      return { ok: true, skills: (ctx.skills || []).filter(s => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).map(s => ({ name: s.name, description: s.description })) };
    }
    case 'web_search':
      return fetchUrlText(`https://duckduckgo.com/html/?q=${encodeURIComponent(a.query || '')}`);
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function summarize(name, args) {
  const a = args || {};
  if (name === 'exec_command') return `执行：${arg(a, 'cmd') || ''}`;
  if (name === 'apply_patch') return '应用 apply_patch';
  if (name === 'request_user_input') return '向你提问';
  if (name === 'spawn_agent') return `子 agent：${a.name || ''}`;
  return `调用 ${name}`;
}
