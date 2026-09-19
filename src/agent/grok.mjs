import { GROK_CHAT_URL } from '../model-fetch.mjs';
import { applyRequestTimezone, applyResponseTimezone } from '../session-timezone.mjs';
import { consumeSse, boundTools, openaiTool, strProp, intProp, boolProp, arrProp, objProp, arg, asObject } from './stream.mjs';
import {
  readWorkspaceFile, writeWorkspaceFile, replaceInFile, listWorkspaceDir, findByGlob, grepSearch,
  runWorkspaceCommand, listBackgroundTasks, killBackgroundTask, fetchUrlText,
} from './workspace-io.mjs';
import { environmentBlock, skillCatalogText } from './context.mjs';
import { compactSystemPrompt } from './compact.mjs';

export const VENDOR = 'grok';

export const RISK = {
  read_file: 'read',
  write: 'write',
  search_replace: 'write',
  list_dir: 'read',
  grep: 'read',
  run_terminal_command: 'exec',
  get_command_or_subagent_output: 'read',
  kill_command_or_subagent: 'exec',
  todo_write: 'none',
  ask_user_question: 'ask',
  enter_plan_mode: 'none',
  exit_plan_mode: 'ask',
  spawn_subagent: 'ask',
  web_fetch: 'net',
  web_search: 'net',
  search_tool: 'read',
  use_tool: 'ask',
  send_feedback: 'none',
};

export function tools() {
  return [
    openaiTool('read_file', 'Read a file. Optional offset/limit.', {
      target_file: strProp('Path'),
      offset: intProp('Start line'),
      limit: intProp('Line count'),
    }, ['target_file']),
    openaiTool('write', 'Create or overwrite a file.', {
      file_path: strProp('Path'),
      content: strProp('Contents'),
    }, ['file_path', 'content']),
    openaiTool('search_replace', 'Exact replace. Empty old_string creates a new file.', {
      file_path: strProp('Path'),
      old_string: strProp('Find; empty creates'),
      new_string: strProp('Replace'),
      replace_all: boolProp('Replace every match'),
    }, ['file_path', 'old_string', 'new_string']),
    openaiTool('list_dir', 'List a directory. Hidden dot-files are omitted.', {
      target_directory: strProp('Directory'),
    }, ['target_directory']),
    openaiTool('grep', 'ripgrep-style content search.', {
      pattern: strProp('Regex'),
      path: strProp('Root'),
      glob: strProp('Glob'),
      head_limit: intProp('Max matches'),
    }, ['pattern']),
    openaiTool('run_terminal_command', 'Run a shell command. Foreground auto-backgrounds after ~15s if still running.', {
      command: strProp('Command'),
      timeout: intProp('Timeout ms'),
      description: strProp('Why this command needs to run'),
      background: boolProp('Background immediately'),
    }, ['command', 'description']),
    openaiTool('get_command_or_subagent_output', 'Poll or wait on a background command or subagent.', {
      task_ids: arrProp('Ids', { type: 'STRING' }),
      timeout_ms: intProp('Wait ms'),
    }),
    openaiTool('kill_command_or_subagent', 'Kill a background command or subagent.', {
      task_id: strProp('Id'),
    }, ['task_id']),
    openaiTool('todo_write', 'Session todo list.', {
      merge: boolProp('Merge by id'),
      todos: arrProp('Items', objProp('todo', {
        id: strProp('Id'),
        content: strProp('Text'),
        status: strProp('pending | in_progress | completed | cancelled'),
      }, ['id'])),
    }, ['todos']),
    openaiTool('ask_user_question', 'Multiple-choice HITL. Host adds Other.', {
      questions: arrProp('Questions', objProp('q', {
        question: strProp('Question'),
        options: arrProp('Options', objProp('opt', {
          label: strProp('Label'),
          description: strProp('Meaning'),
        }, ['label', 'description'])),
        multi_select: boolProp('Multi'),
      }, ['question', 'options'])),
    }, ['questions']),
    openaiTool('enter_plan_mode', 'Enter read-only plan. Only plan.md is writable even in always-approve.', {}),
    openaiTool('exit_plan_mode', 'Leave plan mode; host shows an approval bar.', {
      plan: strProp('Plan markdown'),
    }),
    openaiTool('spawn_subagent', 'Spawn a child session. Builtin types: general-purpose, explore, plan.', {
      prompt: strProp('Task'),
      description: strProp('3-5 words'),
      subagent_type: strProp('general-purpose | explore | plan'),
      background: boolProp('Background'),
      isolation: strProp('none | worktree'),
    }, ['prompt', 'description']),
    openaiTool('web_fetch', 'Fetch a URL as text/markdown.', { url: strProp('URL') }, ['url']),
    openaiTool('web_search', 'Web search. Often a backend server tool; this workbench implements a client fetch fallback.', {
      query: strProp('Query'),
    }, ['query']),
    openaiTool('search_tool', 'Search connected MCP tools. Workbench MCP is empty unless configured.', {
      query: strProp('Keywords'),
    }, ['query']),
    openaiTool('use_tool', 'Invoke server__tool after search_tool. Do not flatten MCP tools into this table.', {
      tool_name: strProp('server__tool'),
      tool_input: objProp('Arguments', {}),
    }, ['tool_name', 'tool_input']),
    openaiTool('send_feedback', 'Local feedback draft only.', {
      title: strProp('Title'),
      details: strProp('Details'),
      type: strProp('bug | idea | missing_capability'),
    }, ['title', 'details', 'type']),
  ];
}

export function systemPrompt(ctx) {
  if (ctx.compacting) return compactSystemPrompt(ctx.compactKeepNote);
  if (ctx.managerIdle) {
    return [ctx.managerNote || '', environmentBlock(ctx)].filter(Boolean).join('\n\n');
  }
  return [
    'You are Grok Build running inside the Agents workbench. Use Grok function names: read_file, search_replace, write, list_dir, grep, run_terminal_command.',
    'MCP is search_tool then use_tool (server__tool). Do not expect flattened MCP tools.',
    'Builtin subagents: general-purpose, explore, plan. Plan mode: only plan.md is writable.',
    ctx.managerNote || '',
    environmentBlock(ctx),
    ctx.rules?.length ? `Project rules:\n${ctx.rules.map(r => `## ${r.file}\n${r.text}`).join('\n\n')}` : '',
    `Skills catalog:\n${skillCatalogText(ctx.skills || [])}`,
  ].filter(Boolean).join('\n\n');
}

export function toMessages(messages) {
  const out = [{ role: 'system', content: '' }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content || '' });
      continue;
    }
    if (m.role !== 'assistant') continue;
    const tool_calls = (m.toolCalls || []).map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}) },
    }));
    out.push({
      role: 'assistant',
      content: m.content || null,
      ...(m.thoughts ? { reasoning_content: m.thoughts } : {}),
      ...(tool_calls.length ? { tool_calls } : {}),
    });
    for (const tr of m.toolResults || []) {
      out.push({ role: 'tool', tool_call_id: tr.toolCallId, content: String(tr.output || tr.error || '') });
    }
  }
  return out;
}

export async function stream(ctx, { messages, onText, onThought, onToolCall }) {
  const msgs = toMessages(messages);
  msgs[0].content = systemPrompt(ctx);
  const payload = applyRequestTimezone({
    model: ctx.model,
    messages: msgs,
    stream: true,
    ...(ctx.effort ? { reasoning_effort: ctx.effort } : {}),
    ...(ctx.compacting ? {} : { tools: boundTools(ctx, tools()) }),
  }, ctx.timezone);
  const response = await ctx.fetcher(GROK_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: ctx.abortSignal || AbortSignal.timeout(180000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`官方模型请求失败：HTTP ${response.status} ${(await response.text()).slice(0, 240)}`);
  let text = '';
  let thoughts = '';
  const toolCalls = [];
  const partial = new Map();
  const takeChoice = event => {
    const zoned = applyResponseTimezone(event, ctx.timezone);
    const choice = zoned.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      thoughts += delta.reasoning_content;
      onThought?.(delta.reasoning_content);
    }
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const tc of delta.tool_calls || []) {
      const idx = tc.index ?? toolCalls.length;
      const cur = partial.get(idx) || { id: tc.id, name: tc.function?.name || '', argsText: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.argsText += tc.function.arguments;
      partial.set(idx, cur);
    }
    if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'stop') {
      for (const cur of partial.values()) {
        if (toolCalls.some(t => t.id === cur.id)) continue;
        const item = { id: cur.id || `call_${crypto.randomUUID()}`, name: cur.name, args: asObject(cur.argsText) };
        toolCalls.push(item);
        onToolCall?.(item);
      }
    }
  };
  await consumeSse(response, takeChoice);
  if (!toolCalls.length && partial.size) {
    for (const cur of partial.values()) {
      const item = { id: cur.id || `call_${crypto.randomUUID()}`, name: cur.name, args: asObject(cur.argsText) };
      toolCalls.push(item);
      onToolCall?.(item);
    }
  }
  return { text, thoughts, toolCalls };
}

export async function execute(name, args, ctx) {
  const a = args || {};
  const allowOutside = ctx.allowOutside;
  switch (name) {
    case 'read_file':
      return readWorkspaceFile(ctx.workspace, arg(a, 'target_file', 'file_path'), { offset: a.offset, limit: a.limit, allowOutside });
    case 'write':
      return writeWorkspaceFile(ctx.workspace, arg(a, 'file_path'), a.content, { allowOutside });
    case 'search_replace':
      if (a.old_string === '') return writeWorkspaceFile(ctx.workspace, a.file_path, a.new_string, { overwrite: false, allowOutside });
      return replaceInFile(ctx.workspace, a.file_path, a.old_string, a.new_string, { replaceAll: Boolean(a.replace_all), allowOutside });
    case 'list_dir':
      return listWorkspaceDir(ctx.workspace, arg(a, 'target_directory') || '.', { allowOutside });
    case 'grep':
      return grepSearch(ctx.workspace, a.pattern, { searchPath: a.path, glob: a.glob, headLimit: a.head_limit, allowOutside });
    case 'run_terminal_command':
    case 'run_terminal_cmd':
      return runWorkspaceCommand(ctx.workspace, a.command, {
        timeoutMs: a.timeout || 0,
        waitMsBeforeAsync: a.background ? 1 : 15000,
        background: Boolean(a.background),
        allowOutside,
        abortSignal: ctx.abortSignal,
      });
    case 'get_command_or_subagent_output':
      return { ok: true, tasks: listBackgroundTasks(ctx.workspace).filter(t => !(a.task_ids || []).length || a.task_ids.includes(t.id)) };
    case 'kill_command_or_subagent':
      return killBackgroundTask(a.task_id);
    case 'todo_write': {
      const merge = a.merge !== false;
      const incoming = Array.isArray(a.todos) ? a.todos : [];
      if (!merge) ctx.transcript.todos = incoming;
      else {
        const map = new Map((ctx.transcript.todos || []).map(t => [t.id, t]));
        for (const t of incoming) {
          const prev = map.get(t.id) || {};
          map.set(t.id, { ...prev, ...t });
        }
        ctx.transcript.todos = [...map.values()];
      }
      return { ok: true, todos: ctx.transcript.todos };
    }
    case 'ask_user_question':
      return { ok: true, questions: a.questions, needsUser: true };
    case 'enter_plan_mode':
      ctx.transcript.mode = 'plan';
      return { ok: true, mode: 'plan' };
    case 'exit_plan_mode':
      ctx.transcript.plan = a.plan || ctx.transcript.plan;
      return { ok: true, plan: ctx.transcript.plan, needsUser: true, leavePlan: true };
    case 'spawn_subagent':
      if (!ctx.runSubagent) return { ok: false, error: 'Subagent runner unavailable' };
      return ctx.runSubagent({ prompt: a.prompt, typeName: a.subagent_type || 'general-purpose', description: a.description });
    case 'web_fetch':
      return fetchUrlText(a.url);
    case 'web_search':
      return fetchUrlText(`https://duckduckgo.com/html/?q=${encodeURIComponent(a.query || '')}`);
    case 'search_tool':
      return { ok: true, tools: [], message: 'No MCP servers connected in this workbench session.' };
    case 'use_tool':
      return { ok: false, error: `MCP tool not connected: ${a.tool_name}` };
    case 'send_feedback':
      return { ok: true, draft: true, title: a.title };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function summarize(name, args) {
  const a = args || {};
  if (name === 'run_terminal_command' || name === 'run_terminal_cmd') return `执行：${a.command || ''}`;
  if (name === 'write' || name === 'search_replace') return `修改 ${a.file_path || ''}`;
  if (name === 'ask_user_question') return '向你提问';
  if (name === 'spawn_subagent') return `子 agent：${a.description || a.subagent_type || ''}`;
  return `调用 ${name}`;
}
