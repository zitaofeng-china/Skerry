import {
  GEMINI_GENERATE_PATH,
  GEMINI_LOAD_PATH,
  GEMINI_MODELS_BASES,
  GEMINI_STREAM_PATH,
  ANTIGRAVITY_USER_AGENT,
  extractGeminiProject,
} from '../model-fetch.mjs';
import { applyRequestTimezone, applyResponseTimezone } from '../session-timezone.mjs';
import { consumeSse, boundTools, geminiTool, strProp, intProp, boolProp, arrProp, objProp, arg, asObject } from './stream.mjs';
import {
  readWorkspaceFile, writeWorkspaceFile, replaceInFile, listWorkspaceDir, findByGlob, grepSearch,
  runWorkspaceCommand, listBackgroundTasks, killBackgroundTask, writeTaskStdin, fetchUrlText,
} from './workspace-io.mjs';
import { environmentBlock, skillCatalogText } from './context.mjs';
import { compactSystemPrompt } from './compact.mjs';

export const VENDOR = 'agy';

export const RISK = {
  view_file: 'read',
  write_to_file: 'write',
  replace_file_content: 'write',
  multi_replace_file_content: 'write',
  list_dir: 'read',
  find_by_name: 'read',
  grep_search: 'read',
  search_web: 'net',
  read_url_content: 'net',
  run_command: 'exec',
  manage_task: 'exec',
  schedule: 'none',
  list_permissions: 'read',
  ask_permission: 'ask',
  invoke_subagent: 'ask',
  define_subagent: 'none',
  send_message: 'none',
  manage_subagents: 'none',
  ask_question: 'ask',
  generate_image: 'none',
};

function geminiHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': ANTIGRAVITY_USER_AGENT,
  };
}

async function loadProject({ accessToken, fetcher, base }) {
  const response = await fetcher(`${base}${GEMINI_LOAD_PATH}`, {
    method: 'POST',
    headers: geminiHeaders(accessToken),
    body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) return '';
  try { return extractGeminiProject(JSON.parse(await response.text())); } catch { return ''; }
}

export function tools() {
  return [
    geminiTool('view_file', 'Read a file by absolute or workspace path and optional line range.', {
      AbsolutePath: strProp('File path'),
      StartLine: intProp('1-based start line'),
      EndLine: intProp('1-based end line'),
      IsSkillFile: boolProp('True when reading a skill file'),
    }, ['AbsolutePath']),
    geminiTool('write_to_file', 'Create or overwrite a file. Default mode shows a diff for approval.', {
      TargetFile: strProp('Path to write'),
      CodeContent: strProp('Full file contents'),
      Overwrite: boolProp('Overwrite if the file exists'),
      Description: strProp('Short description of the write'),
      IsArtifact: boolProp('Mark as reviewable artifact'),
    }, ['TargetFile', 'CodeContent']),
    geminiTool('replace_file_content', 'Replace one contiguous block in a file.', {
      TargetFile: strProp('Path'),
      TargetContent: strProp('Exact text to find'),
      ReplacementContent: strProp('Replacement text'),
      AllowMultiple: boolProp('Replace every match'),
    }, ['TargetFile', 'TargetContent', 'ReplacementContent']),
    geminiTool('multi_replace_file_content', 'Several non-contiguous replacements in one file.', {
      TargetFile: strProp('Path'),
      ReplacementChunks: arrProp('Chunks', objProp('chunk', {
        TargetContent: strProp('Find'),
        ReplacementContent: strProp('Replace'),
        AllowMultiple: boolProp('Replace every match'),
      }, ['TargetContent', 'ReplacementContent'])),
    }, ['TargetFile', 'ReplacementChunks']),
    geminiTool('list_dir', 'List a directory.', { DirectoryPath: strProp('Directory path') }, ['DirectoryPath']),
    geminiTool('find_by_name', 'Find files by glob, type, or extension.', {
      Pattern: strProp('Glob pattern'),
      Directory: strProp('Root directory'),
      Type: strProp('file or directory'),
      MaxDepth: intProp('Max depth'),
    }, ['Pattern']),
    geminiTool('grep_search', 'Regex or text search under a path.', {
      Query: strProp('Pattern'),
      SearchPath: strProp('Directory or file'),
      IsRegex: boolProp('Treat Query as regex'),
      Includes: strProp('Glob filter'),
    }, ['Query']),
    geminiTool('search_web', 'Web search, optional domain filter.', {
      query: strProp('Search query'),
      domain: strProp('Optional domain limit'),
    }, ['query']),
    geminiTool('read_url_content', 'Fetch public URL text.', { Url: strProp('https URL') }, ['Url']),
    geminiTool('run_command', 'Run a shell command in the workspace. Can background.', {
      CommandLine: strProp('Command line'),
      Cwd: strProp('Working directory'),
      WaitMsBeforeAsync: intProp('Return a background id if still running after this many ms'),
      RunPersistent: boolProp('Keep a persistent terminal'),
      RequestedTerminalID: strProp('Reuse a terminal id'),
    }, ['CommandLine']),
    geminiTool('manage_task', 'list / kill / status / send_input for background tasks.', {
      Action: strProp('list | kill | status | send_input'),
      TaskId: strProp('Task id'),
      Input: strProp('stdin for send_input'),
    }, ['Action']),
    geminiTool('schedule', 'One-shot timer or cron prompt.', {
      Prompt: strProp('Prompt to run later'),
      DurationSeconds: intProp('Delay seconds'),
      CronExpression: strProp('Cron expression'),
    }, ['Prompt']),
    geminiTool('list_permissions', 'List current grants.', {}),
    geminiTool('ask_permission', 'Request a scoped grant. Official name is ask_permission (not ask_custom_permission).', {
      Action: strProp('read_file | write_file | command | read_url | execute_url | mcp | unsandboxed'),
      Target: strProp('Path, command, or URL'),
      Reason: strProp('Why it is needed'),
    }, ['Action', 'Target', 'Reason']),
    geminiTool('invoke_subagent', 'Spawn a specialized subagent.', {
      Prompt: strProp('Task'),
      Role: strProp('Role'),
      TypeName: strProp('research | browser | self | custom type'),
      Workspace: strProp('inherit | branch | share'),
    }, ['Prompt']),
    geminiTool('define_subagent', 'Define a custom subagent at runtime.', {
      Name: strProp('Type name'),
      Description: strProp('What it does'),
      Prompt: strProp('System prompt'),
    }, ['Name', 'Prompt']),
    geminiTool('send_message', 'Message another agent.', {
      Recipient: strProp('Agent id or name'),
      Message: strProp('Message'),
    }, ['Recipient', 'Message']),
    geminiTool('manage_subagents', 'list / kill / kill_all running subagents.', {
      Action: strProp('list | kill | kill_all'),
      AgentId: strProp('Subagent id'),
    }, ['Action']),
    geminiTool('ask_question', 'Multiple-choice questions for the user.', {
      questions: arrProp('Questions', objProp('question', {
        question: strProp('Question text'),
        header: strProp('Short header'),
        options: arrProp('Options', objProp('option', {
          label: strProp('Label'),
          description: strProp('What this choice means'),
        }, ['label', 'description'])),
        multiSelect: boolProp('Allow more than one'),
      }, ['question', 'options'])),
    }, ['questions']),
    geminiTool('generate_image', 'Generate or edit an image from a prompt. Not hosted in this workbench process.', {
      Prompt: strProp('Image prompt'),
    }, ['Prompt']),
  ];
}

export function systemPrompt(ctx) {
  if (ctx.compacting) return compactSystemPrompt(ctx.compactKeepNote);
  if (ctx.managerIdle) {
    return [ctx.managerNote || '', environmentBlock(ctx)].filter(Boolean).join('\n\n');
  }
  return [
    'You are Antigravity CLI (agy) running inside the Agents workbench. Use the official agy tool names.',
    'Do not pretend to be Gemini CLI. Official Google Gemini in this workbench is the agy harness.',
    'Workspace reads/writes use view_file, write_to_file, replace_file_content, list_dir, find_by_name, grep_search, run_command.',
    'Default mode pauses on file writes for a diff. accept-edits applies file changes. plan is read-only until the user confirms an Implementation Plan.',
    'Builtin subagent types: research, browser, self. Browser is opt-in via /browser.',
    'Skills are mounted by name; read a skill file with view_file and IsSkillFile=true only when you need the full text.',
    ctx.managerNote || '',
    environmentBlock(ctx),
    ctx.rules?.length ? `Project rules:\n${ctx.rules.map(r => `## ${r.file}\n${r.text}`).join('\n\n')}` : '',
    `Skills catalog:\n${skillCatalogText(ctx.skills || [])}`,
  ].filter(Boolean).join('\n\n');
}

export function toContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
      continue;
    }
    if (m.role === 'assistant') {
      const parts = [];
      if (m.thoughts) parts.push({ text: m.thoughts, thought: true });
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls || []) {
        const part = { functionCall: { name: tc.name, args: asObject(tc.args) } };
        if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
        if (tc.thought_signature) part.thought_signature = tc.thought_signature;
        parts.push(part);
      }
      if (!parts.length) parts.push({ text: '' });
      contents.push({ role: 'model', parts });
      if (m.toolResults?.length) {
        contents.push({
          role: 'user',
          parts: m.toolResults.map(tr => ({
            functionResponse: {
              name: tr.toolName || 'tool',
              response: { output: tr.output || tr.error || '' },
            },
          })),
        });
      }
    }
  }
  return contents;
}

function extractParts(event) {
  const bags = [event, event?.response, event?.result].filter(Boolean);
  for (const bag of bags) {
    const parts = bag?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) return { parts, candidate: bag.candidates[0] };
  }
  return { parts: [], candidate: null };
}

export async function stream(ctx, { messages, onText, onThought, onToolCall }) {
  let lastError;
  const contents = toContents(messages);
  const payloadBase = {
    model: ctx.model,
    userAgent: 'antigravity',
    requestType: 'agent',
    requestId: `agent-${crypto.randomUUID()}`,
    request: {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt(ctx) }] },
      generationConfig: { maxOutputTokens: 8192, temperature: 1 },
      ...(ctx.compacting ? {} : { tools: [{ functionDeclarations: boundTools(ctx, tools()) }] }),
    },
  };
  const headers = geminiHeaders(ctx.accessToken);
  for (const base of GEMINI_MODELS_BASES) {
    try {
      const project = await loadProject({ accessToken: ctx.accessToken, fetcher: ctx.fetcher, base });
      const payload = applyRequestTimezone(project ? { ...payloadBase, project } : payloadBase, ctx.timezone);
      const url = `${base}${GEMINI_STREAM_PATH}`;
      let response = await ctx.fetcher(url, {
        method: 'POST',
        headers: { ...headers, Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
        signal: ctx.abortSignal || AbortSignal.timeout(180000),
        redirect: 'error',
      });
      if (!response.ok) {
        response = await ctx.fetcher(`${base}${GEMINI_GENERATE_PATH}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: ctx.abortSignal || AbortSignal.timeout(180000),
          redirect: 'error',
        });
      }
      if (!response.ok) {
        lastError = new Error(`官方模型请求失败：HTTP ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
        continue;
      }
      let text = '';
      let thoughts = '';
      const toolCalls = [];
      const onJson = event => {
        const zoned = applyResponseTimezone(event, ctx.timezone);
        const { parts } = extractParts(zoned);
        for (const part of parts) {
          if (part.functionCall) {
            const tc = {
              id: `call_${crypto.randomUUID()}`,
              name: part.functionCall.name,
              args: asObject(part.functionCall.args),
              thoughtSignature: part.thoughtSignature || part.thought_signature,
            };
            toolCalls.push(tc);
            onToolCall?.(tc);
          } else if (typeof part.text === 'string' && part.text) {
            if (part.thought) {
              thoughts += part.text;
              onThought?.(part.text);
            } else {
              text += part.text;
              onText?.(part.text);
            }
          }
        }
      };
      await consumeSse(response, onJson);
      return { text, thoughts, toolCalls };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('官方 Gemini / Antigravity 请求失败');
}

export async function execute(name, args, ctx) {
  const a = args || {};
  const allowOutside = ctx.allowOutside;
  switch (name) {
    case 'view_file':
      return readWorkspaceFile(ctx.workspace, arg(a, 'AbsolutePath', 'path'), {
        startLine: a.StartLine, endLine: a.EndLine, allowOutside,
      });
    case 'write_to_file':
      return writeWorkspaceFile(ctx.workspace, arg(a, 'TargetFile'), arg(a, 'CodeContent', 'content'), {
        overwrite: a.Overwrite !== false, allowOutside,
      });
    case 'replace_file_content':
      return replaceInFile(ctx.workspace, arg(a, 'TargetFile'), arg(a, 'TargetContent'), arg(a, 'ReplacementContent'), {
        replaceAll: Boolean(a.AllowMultiple), allowOutside,
      });
    case 'multi_replace_file_content': {
      const chunks = Array.isArray(a.ReplacementChunks) ? a.ReplacementChunks : [];
      const results = [];
      for (const chunk of chunks) {
        results.push(replaceInFile(ctx.workspace, arg(a, 'TargetFile'), chunk.TargetContent, chunk.ReplacementContent, {
          replaceAll: Boolean(chunk.AllowMultiple), allowOutside,
        }));
      }
      return { ok: results.every(r => r.ok), results };
    }
    case 'list_dir':
      return listWorkspaceDir(ctx.workspace, arg(a, 'DirectoryPath', 'path') || '.', { allowOutside });
    case 'find_by_name':
      return findByGlob(ctx.workspace, arg(a, 'Pattern', 'pattern'), { directory: arg(a, 'Directory'), allowOutside });
    case 'grep_search':
      return grepSearch(ctx.workspace, arg(a, 'Query', 'pattern'), {
        searchPath: arg(a, 'SearchPath'), regex: a.IsRegex !== false, glob: a.Includes, allowOutside,
      });
    case 'search_web': {
      const q = encodeURIComponent(String(arg(a, 'query', 'Query') || ''));
      const domain = arg(a, 'domain') ? ` site:${arg(a, 'domain')}` : '';
      return fetchUrlText(`https://duckduckgo.com/html/?q=${q}${encodeURIComponent(domain)}`);
    }
    case 'read_url_content':
      return fetchUrlText(arg(a, 'Url', 'url'));
    case 'run_command':
      return runWorkspaceCommand(ctx.workspace, arg(a, 'CommandLine', 'command'), {
        cwd: arg(a, 'Cwd'),
        waitMsBeforeAsync: Number(a.WaitMsBeforeAsync) || (a.RunPersistent ? 1 : 0),
        background: Boolean(a.RunPersistent),
        allowOutside,
        timeoutMs: a.RunPersistent ? 0 : 120000,
        abortSignal: ctx.abortSignal,
      });
    case 'manage_task': {
      const action = String(arg(a, 'Action') || '').toLowerCase();
      if (action === 'list') return { ok: true, tasks: listBackgroundTasks(ctx.workspace) };
      if (action === 'kill') return killBackgroundTask(arg(a, 'TaskId'));
      if (action === 'send_input') return writeTaskStdin(arg(a, 'TaskId'), arg(a, 'Input'));
      if (action === 'status') return { ok: true, tasks: listBackgroundTasks(ctx.workspace).filter(t => t.id === arg(a, 'TaskId')) };
      return { ok: false, error: 'Unknown Action' };
    }
    case 'schedule':
      return { ok: true, message: 'Workbench stores the schedule locally; recurring fire is not a host daemon yet.', prompt: arg(a, 'Prompt'), duration: a.DurationSeconds, cron: a.CronExpression };
    case 'list_permissions':
      return { ok: true, mode: ctx.mode, workspace: ctx.workspace, allowNonWorkspaceAccess: Boolean(ctx.allowOutside) };
    case 'ask_permission':
      return { ok: true, granted: true, action: arg(a, 'Action'), target: arg(a, 'Target') };
    case 'invoke_subagent':
      if (!ctx.runSubagent) return { ok: false, error: 'Subagent runner unavailable' };
      return ctx.runSubagent({
        prompt: arg(a, 'Prompt'),
        typeName: arg(a, 'TypeName') || 'self',
        role: arg(a, 'Role'),
      });
    case 'define_subagent':
      ctx.definedAgents = ctx.definedAgents || {};
      ctx.definedAgents[arg(a, 'Name')] = a;
      return { ok: true, name: arg(a, 'Name') };
    case 'send_message':
      return { ok: true, queued: true, recipient: arg(a, 'Recipient') };
    case 'manage_subagents':
      return { ok: true, agents: ctx.childAgents || [] };
    case 'ask_question':
      return { ok: true, questions: a.questions, needsUser: true };
    case 'generate_image':
      return { ok: false, error: 'generate_image is not hosted inside the workbench process.' };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function summarize(name, args) {
  const a = args || {};
  if (name === 'run_command') return `执行命令：${arg(a, 'CommandLine') || ''}`;
  if (name === 'write_to_file') return `写入 ${arg(a, 'TargetFile') || ''}`;
  if (name === 'replace_file_content' || name === 'multi_replace_file_content') return `修改 ${arg(a, 'TargetFile') || ''}`;
  if (name === 'ask_question') return '向你提问';
  if (name === 'invoke_subagent') return `派生子 agent：${arg(a, 'TypeName') || 'self'}`;
  return `调用 ${name}`;
}
