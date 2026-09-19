import { CLAUDE_MESSAGES_URL, CLAUDE_OAUTH_BETA } from '../model-fetch.mjs';
import { applyRequestTimezone, applyResponseTimezone } from '../session-timezone.mjs';
import { consumeSse, boundTools, claudeTool, strProp, intProp, boolProp, arrProp, objProp, arg, asObject } from './stream.mjs';
import {
  readWorkspaceFile, writeWorkspaceFile, replaceInFile, listWorkspaceDir, findByGlob, grepSearch,
  runWorkspaceCommand, listBackgroundTasks, killBackgroundTask, fetchUrlText,
} from './workspace-io.mjs';
import { environmentBlock, skillCatalogText } from './context.mjs';
import { compactSystemPrompt } from './compact.mjs';

export const VENDOR = 'claude';

export const RISK = {
  Read: 'read',
  Write: 'write',
  Edit: 'write',
  Glob: 'read',
  Grep: 'read',
  Bash: 'exec',
  PowerShell: 'exec',
  WebFetch: 'net',
  WebSearch: 'net',
  Skill: 'read',
  TodoWrite: 'none',
  AskUserQuestion: 'ask',
  Agent: 'ask',
  EnterPlanMode: 'none',
  ExitPlanMode: 'ask',
  TaskCreate: 'none',
  TaskGet: 'read',
  TaskList: 'read',
  TaskUpdate: 'none',
  TaskOutput: 'read',
  TaskStop: 'exec',
  SendMessage: 'none',
  ListAgents: 'read',
  SendFeedback: 'none',
  NotebookEdit: 'write',
  Monitor: 'exec',
};

export function tools() {
  return [
    claudeTool('Read', 'Read a file. Prefer absolute paths.', {
      file_path: strProp('Absolute path'),
      offset: intProp('1-based start line'),
      limit: intProp('Number of lines'),
    }, ['file_path']),
    claudeTool('Write', 'Create or overwrite a file.', {
      file_path: strProp('Absolute path'),
      content: strProp('Full contents'),
    }, ['file_path', 'content']),
    claudeTool('Edit', 'Exact string replace in a file.', {
      file_path: strProp('Absolute path'),
      old_string: strProp('Text to find'),
      new_string: strProp('Replacement'),
      replace_all: boolProp('Replace every match'),
    }, ['file_path', 'old_string', 'new_string']),
    claudeTool('Glob', 'Find files by glob.', {
      pattern: strProp('Glob pattern'),
      path: strProp('Directory'),
    }, ['pattern']),
    claudeTool('Grep', 'Regex search. Windows has a dedicated Grep tool.', {
      pattern: strProp('Regex'),
      path: strProp('File or directory'),
      glob: strProp('Glob filter'),
      output_mode: strProp('content | files_with_matches | count'),
      head_limit: intProp('Max matches'),
    }, ['pattern']),
    claudeTool('Bash', 'Run a shell command. On Windows this is PowerShell-backed.', {
      command: strProp('Command'),
      timeout: intProp('Timeout ms'),
      description: strProp('Short description'),
      run_in_background: boolProp('Background'),
    }, ['command']),
    claudeTool('PowerShell', 'Native PowerShell on Windows. Permission matcher PowerShell(...).', {
      command: strProp('Command'),
      timeout: intProp('Timeout ms'),
      description: strProp('Short description'),
      run_in_background: boolProp('Background'),
    }, ['command']),
    claudeTool('WebFetch', 'Fetch a URL then extract with a prompt.', {
      url: strProp('URL'),
      prompt: strProp('Extraction prompt'),
    }, ['url', 'prompt']),
    claudeTool('WebSearch', 'Web search with optional domain filters.', {
      query: strProp('Query'),
      allowed_domains: arrProp('Allow domains', { type: 'STRING' }),
      blocked_domains: arrProp('Block domains', { type: 'STRING' }),
    }, ['query']),
    claudeTool('Skill', 'Load a skill SKILL.md into this thread.', {
      skill: strProp('Skill name'),
    }, ['skill']),
    claudeTool('TodoWrite', 'Legacy checklist. Some models prefer Task* instead.', {
      todos: arrProp('Todos', objProp('todo', {
        content: strProp('Task'),
        activeForm: strProp('Active form'),
        status: strProp('pending | in_progress | completed'),
      }, ['content', 'status', 'activeForm'])),
    }, ['todos']),
    claudeTool('AskUserQuestion', '1–4 multiple-choice questions. Other is added by the host.', {
      questions: arrProp('Questions', objProp('q', {
        question: strProp('Question'),
        header: strProp('Short header'),
        options: arrProp('Options', objProp('opt', {
          label: strProp('Label'),
          description: strProp('Meaning'),
        }, ['label', 'description'])),
        multiSelect: boolProp('Multi'),
      }, ['question', 'header', 'options'])),
    }, ['questions']),
    claudeTool('Agent', 'Spawn a subagent with its own context. Explore is read-only.', {
      description: strProp('3-5 word description'),
      prompt: strProp('Task'),
      subagent_type: strProp('Explore or a custom type'),
      run_in_background: boolProp('Background (default true in Claude Code)'),
      name: strProp('Addressable name'),
      isolation: strProp('worktree | remote'),
    }, ['description', 'prompt']),
    claudeTool('EnterPlanMode', 'Enter read-only plan mode.', {}),
    claudeTool('ExitPlanMode', 'Submit a plan for approval then leave plan mode.', {
      plan: strProp('Plan markdown'),
    }),
    claudeTool('TaskCreate', 'Create a task node.', {
      subject: strProp('Subject'),
      description: strProp('Details'),
    }, ['subject']),
    claudeTool('TaskList', 'List tasks.', {}),
    claudeTool('TaskGet', 'Get a task.', { taskId: strProp('Id') }, ['taskId']),
    claudeTool('TaskUpdate', 'Update a task.', {
      taskId: strProp('Id'),
      status: strProp('Status'),
    }, ['taskId']),
    claudeTool('TaskOutput', 'Poll background task/agent output.', {
      task_id: strProp('Id'),
      block: boolProp('Wait'),
      timeout: intProp('Timeout ms'),
    }, ['task_id']),
    claudeTool('TaskStop', 'Stop a background task or named agent.', { task_id: strProp('Id') }, ['task_id']),
    claudeTool('SendMessage', 'Message a subagent or teammate.', {
      to: strProp('Name'),
      message: strProp('Message'),
    }, ['to', 'message']),
    claudeTool('ListAgents', 'List reachable agents.', {}),
    claudeTool('SendFeedback', 'Write a local feedback draft only.', {
      title: strProp('Title'),
      details: strProp('Details'),
    }, ['title', 'details']),
  ];
}

export function systemPrompt(ctx) {
  if (ctx.compacting) return compactSystemPrompt(ctx.compactKeepNote);
  if (ctx.managerIdle) {
    return [ctx.managerNote || '', environmentBlock(ctx)].filter(Boolean).join('\n\n');
  }
  return [
    'You are Claude Code running inside the Agents workbench. Use Claude Code tool names (Read, Edit, Write, Glob, Grep, Bash, PowerShell on Windows).',
    'Do not call Gemini/Grok/Codex tool names. Permission modes: default, acceptEdits, plan, auto, dontAsk, bypassPermissions.',
    'Skills are listed by name; call Skill to load full text when needed.',
    ctx.managerNote || '',
    environmentBlock(ctx),
    ctx.rules?.length ? `Project rules:\n${ctx.rules.map(r => `## ${r.file}\n${r.text}`).join('\n\n')}` : '',
    `Skills catalog:\n${skillCatalogText(ctx.skills || [])}`,
  ].filter(Boolean).join('\n\n');
}

export function toMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content || '' });
      continue;
    }
    if (m.role !== 'assistant') continue;
    const content = [];
    if (m.thoughts) content.push({ type: 'thinking', thinking: m.thoughts, signature: m.thinkingSignature || undefined });
    if (m.content) content.push({ type: 'text', text: m.content });
    for (const tc of m.toolCalls || []) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: asObject(tc.args) });
    }
    out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
    if (m.toolResults?.length) {
      out.push({
        role: 'user',
        content: m.toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.toolCallId,
          content: String(tr.output || tr.error || ''),
          is_error: Boolean(tr.error && !tr.output),
        })),
      });
    }
  }
  return out;
}

export async function stream(ctx, { messages, onText, onThought, onToolCall }) {
  const payload = applyRequestTimezone({
    model: ctx.model,
    max_tokens: 16384,
    stream: true,
    system: systemPrompt(ctx),
    messages: toMessages(messages),
    ...(ctx.compacting ? {} : { tools: boundTools(ctx, tools()) }),
  }, ctx.timezone);
  const response = await ctx.fetcher(CLAUDE_MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'text/event-stream',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': `${CLAUDE_OAUTH_BETA},claude-code-20250219`,
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
  await consumeSse(response, event => {
    const zoned = applyResponseTimezone(event, ctx.timezone);
    const type = zoned.type;
    if (type === 'content_block_start') {
      const block = zoned.content_block;
      if (block?.type === 'tool_use') partial.set(zoned.index, { id: block.id, name: block.name, argsText: '' });
      if (block?.type === 'thinking' && block.thinking) {
        thoughts += block.thinking;
        onThought?.(block.thinking);
      }
    } else if (type === 'content_block_delta') {
      const d = zoned.delta || {};
      if (d.type === 'text_delta' && d.text) { text += d.text; onText?.(d.text); }
      if (d.type === 'thinking_delta' && d.thinking) { thoughts += d.thinking; onThought?.(d.thinking); }
      if (d.type === 'input_json_delta' && d.partial_json) {
        const item = partial.get(zoned.index);
        if (item) item.argsText += d.partial_json;
      }
    } else if (type === 'content_block_stop') {
      const item = partial.get(zoned.index);
      if (item) {
        const tc = { id: item.id, name: item.name, args: asObject(item.argsText) };
        toolCalls.push(tc);
        onToolCall?.(tc);
      }
    } else if (!type && Array.isArray(zoned.content)) {
      for (const block of zoned.content) {
        if (block.type === 'text' && block.text) { text += block.text; onText?.(block.text); }
        if (block.type === 'thinking' && block.thinking) { thoughts += block.thinking; onThought?.(block.thinking); }
        if (block.type === 'tool_use') {
          const tc = { id: block.id, name: block.name, args: asObject(block.input) };
          toolCalls.push(tc);
          onToolCall?.(tc);
        }
      }
    }
  });
  return { text, thoughts, toolCalls };
}

export async function execute(name, args, ctx) {
  const a = args || {};
  const allowOutside = ctx.allowOutside;
  switch (name) {
    case 'Read':
      return readWorkspaceFile(ctx.workspace, arg(a, 'file_path'), { offset: a.offset, limit: a.limit, allowOutside });
    case 'Write':
      return writeWorkspaceFile(ctx.workspace, arg(a, 'file_path'), a.content, { allowOutside });
    case 'Edit':
      return replaceInFile(ctx.workspace, arg(a, 'file_path'), a.old_string, a.new_string, { replaceAll: Boolean(a.replace_all), allowOutside });
    case 'Glob':
      return findByGlob(ctx.workspace, a.pattern, { directory: a.path, allowOutside });
    case 'Grep': {
      const result = grepSearch(ctx.workspace, a.pattern, { searchPath: a.path, glob: a.glob, headLimit: a.head_limit || 200, allowOutside });
      if (a.output_mode === 'files_with_matches') {
        return { ok: true, files: [...new Set((result.matches || []).map(m => m.path))] };
      }
      return result;
    }
    case 'Bash':
    case 'PowerShell':
      return runWorkspaceCommand(ctx.workspace, a.command, {
        timeoutMs: a.timeout || 120000,
        background: Boolean(a.run_in_background),
        allowOutside,
        abortSignal: ctx.abortSignal,
      });
    case 'WebFetch': {
      const page = await fetchUrlText(a.url);
      return { ...page, prompt: a.prompt };
    }
    case 'WebSearch':
      return fetchUrlText(`https://duckduckgo.com/html/?q=${encodeURIComponent(a.query || '')}`);
    case 'Skill': {
      const skill = (ctx.skills || []).find(s => s.name === a.skill);
      if (!skill) return { ok: false, error: `Skill not found: ${a.skill}` };
      return { ok: true, name: skill.name, description: skill.description, body: skill.body };
    }
    case 'TodoWrite':
      ctx.transcript.todos = a.todos || [];
      return { ok: true, todos: ctx.transcript.todos };
    case 'AskUserQuestion':
      return { ok: true, questions: a.questions, needsUser: true };
    case 'Agent':
      if (!ctx.runSubagent) return { ok: false, error: 'Subagent runner unavailable' };
      return ctx.runSubagent({ prompt: a.prompt, typeName: a.subagent_type || 'Explore', description: a.description });
    case 'EnterPlanMode':
      ctx.transcript.mode = 'plan';
      return { ok: true, mode: 'plan' };
    case 'ExitPlanMode':
      ctx.transcript.plan = a.plan || ctx.transcript.plan;
      return { ok: true, plan: ctx.transcript.plan, needsUser: true, leavePlan: true };
    case 'TaskCreate':
      ctx.transcript.tasks = ctx.transcript.tasks || [];
      ctx.transcript.tasks.push({ id: crypto.randomUUID(), subject: a.subject, description: a.description, status: 'pending' });
      return { ok: true, tasks: ctx.transcript.tasks };
    case 'TaskList':
      return { ok: true, tasks: ctx.transcript.tasks || [] };
    case 'TaskGet':
      return { ok: true, task: (ctx.transcript.tasks || []).find(t => t.id === a.taskId) };
    case 'TaskUpdate': {
      const task = (ctx.transcript.tasks || []).find(t => t.id === a.taskId);
      if (task && a.status) task.status = a.status;
      return { ok: true, task };
    }
    case 'TaskOutput':
      return { ok: true, tasks: listBackgroundTasks(ctx.workspace).filter(t => t.id === a.task_id) };
    case 'TaskStop':
      return killBackgroundTask(a.task_id);
    case 'SendMessage':
      return { ok: true, queued: true };
    case 'ListAgents':
      return { ok: true, agents: ctx.childAgents || [] };
    case 'SendFeedback':
      return { ok: true, draft: true, title: a.title };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function summarize(name, args) {
  const a = args || {};
  if (name === 'Bash' || name === 'PowerShell') return `执行：${a.command || ''}`;
  if (name === 'Write' || name === 'Edit') return `修改 ${a.file_path || ''}`;
  if (name === 'AskUserQuestion') return '向你提问';
  if (name === 'Agent') return `子 agent：${a.description || a.subagent_type || ''}`;
  return `调用 ${name}`;
}
