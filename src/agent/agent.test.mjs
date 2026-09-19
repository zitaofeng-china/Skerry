import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { familyToolsFor, groupLabel, managerActorIdentity, pickFamily, pickVendor, runTurn, vendorLabel } from './loop.mjs';
import { tools as agyTools, toContents as agyToContents } from './agy.mjs';
import { tools as claudeTools } from './claude.mjs';
import { tools as grokTools } from './grok.mjs';
import { stream as codexStream, tools as codexTools } from './codex.mjs';
import { stream as customStream, tools as customTools } from './custom.mjs';
import { applyPatch } from './patch.mjs';
import { readWorkspaceFile, writeWorkspaceFile, replaceInFile, grepSearch } from './workspace-io.mjs';
import { decidePermission, modeOptions, normalizeMode } from './permissions.mjs';
import { loadTranscript, saveTranscript, publicTranscript } from './store.mjs';
import { parseToolArgs } from './stream.mjs';
import { handleHistory, handleHitl, handleMode } from './chat.mjs';

test('官方连接按产品选 harness，不合成一张工具表', () => {
  const chat = fs.readFileSync(new URL('./chat.mjs', import.meta.url), 'utf8');
  assert.match(chat, /resolveChatModel/);
  assert.match(chat, /hydrateConnection/);
  assert.match(chat, /freezeManager/);
  assert.match(chat, /workerPartitions/);
  assert.match(chat, /clonePartitions/);
  assert.match(chat, /isManagerPartition/);
  assert.match(chat, /startBackgroundJob/);
  assert.match(chat, /status: 'running'/);
  assert.match(chat, /kind: 'clone_result'/);
  assert.match(chat, /kind: 'dispatch_result'/);
  assert.match(chat, /type: 'worker'/);
  assert.match(chat, /preferActiveRoute/);
  assert.match(chat, /session_update/);
  assert.match(chat, /onJobHitl/);
  assert.match(chat, /approval\.targetId === thisTarget/);
  assert.match(chat, /被用户中止/);
  assert.match(chat, /用户直接向/);
  assert.match(chat, /type: 'note'/);
  assert.match(chat, /scope === 'group'/);
  assert.match(chat, /管理者本轮失败/);
  assert.match(chat, /prompt,/);
  assert.match(chat, /pickFamily/);
  assert.match(chat, /familyOf/);
  const loop = fs.readFileSync(new URL('./loop.mjs', import.meta.url), 'utf8');
  assert.match(loop, /managerIdle/);
  assert.match(loop, /workbench_spawn_clone/);
  assert.match(loop, /workbench_list_targets/);
  assert.match(loop, /MUST call workbench_dispatch/);
  assert.match(loop, /persist\(ctx\);\s*throw error/s);
  assert.equal(pickVendor({ id: 'official-gemini' }), 'agy');
  assert.equal(pickVendor({ id: 'official-claude' }), 'claude');
  assert.equal(pickVendor({ id: 'official-codex' }), 'codex');
  assert.equal(pickVendor({ id: 'official-grok' }), 'grok');
  assert.equal(pickVendor({ id: 'custom-1', protocol: 'openai' }), 'custom');
  assert.equal(pickFamily({ id: 'c1', name: 'kiro', modelGroups: ['claude'] }), 'claude');
  assert.equal(groupLabel({ id: 'c1', name: 'kiro', modelGroups: ['claude'] }), 'Claude');
  assert.equal(pickFamily({ id: 'official-grok' }), 'grok');
  assert.equal(groupLabel({ id: 'official-gemini' }), 'Gemini');
  assert.ok(familyToolsFor('claude', 'responses').some(t => t.name === 'Write'));
  assert.equal(vendorLabel('agy'), 'Antigravity');
  const grokActor = managerActorIdentity({
    connection: { id: 'g1', name: 'Grok-测试', modelGroups: ['grok'] },
    model: 'grok-4.6',
    effort: 'xhigh',
    vendor: 'custom',
  });
  assert.equal(grokActor.series, 'Grok');
  assert.equal(grokActor.model, 'grok-4.6');
  assert.equal(grokActor.actor, 'Grok · grok-4.6 · 极高');
  const claudeActor = managerActorIdentity({
    connection: { id: 'kiro', name: 'kiro', modelGroups: ['claude'] },
    model: 'claude-sonnet-5',
    effort: 'medium',
    vendor: 'custom',
  });
  assert.equal(claudeActor.series, 'Claude');
  assert.equal(claudeActor.actor, 'Claude · claude-sonnet-5 · 中');
  assert.equal(managerActorIdentity({ vendor: 'grok', model: 'grok-4.6' }).series, 'Grok');
  assert.match(loop, /You currently ARE/);
  assert.match(loop, /maybeCompact/);
  assert.match(loop, /runCompactCommand/);
  assert.match(loop, /slash === 'compact'/);
  assert.match(loop, /compacting/);
  assert.match(chat, /vendorLabel: groupLabel\(route\.connection\)/);
  assert.match(chat, /resolveContextWindow/);
  assert.match(chat, /snapshotActorContext/);
  assert.match(loop, /emitDone/);
  assert.match(chat, /contextWindow: route\.contextWindow/);
  const agyNames = agyTools().map(t => t.name);
  const claudeNames = claudeTools().map(t => t.name);
  const grokNames = grokTools().map(t => t.function.name);
  const codexNames = codexTools().map(t => t.name);
  assert.ok(agyNames.includes('view_file') && agyNames.includes('run_command') && agyNames.includes('invoke_subagent'));
  assert.ok(!agyNames.includes('read_file') && !agyNames.includes('Read'));
  assert.ok(claudeNames.includes('Read') && claudeNames.includes('PowerShell') && claudeNames.includes('AskUserQuestion'));
  assert.ok(grokNames.includes('read_file') && grokNames.includes('run_terminal_command') && grokNames.includes('search_tool'));
  assert.ok(codexNames.includes('exec_command') && codexNames.includes('write_stdin') && codexNames.includes('apply_patch'));
  assert.ok(!codexNames.includes('shell') && !codexNames.includes('shell_command'));
  assert.deepEqual(customTools(), []);
});

test('自定义 Responses 协议走 /responses 并解析 output_text.delta', async () => {
  const calls = [];
  const chunks = [];
  const result = await customStream({
    protocol: 'responses',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    effort: 'medium',
    fetcher: async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        async text() {
          return [
            'data: {"type":"response.output_text.delta","delta":"hello "}',
            'data: {"type":"response.output_text.delta","delta":"world"}',
            'data: {"type":"response.completed","response":{"output_text":"hello world"}}',
            '',
          ].join('\n\n');
        },
      };
    },
  }, { messages: [{ role: 'user', content: 'hi' }], onText: chunk => chunks.push(chunk) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/responses');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.model, 'gpt-test');
  assert.deepEqual(calls[0].body.reasoning, { effort: 'medium' });
  assert.equal(calls[0].body.input[0].role, 'user');
  assert.equal(calls[0].body.input[0].content[0].type, 'input_text');
  assert.equal(result.text, 'hello world');
  assert.deepEqual(chunks, ['hello ', 'world']);
});

function sseOk(events) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    async text() {
      return events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
    },
  };
}

test('自定义 Responses 解析 function_call（item_id 与 call_id 分键）且未传 onToolCall 不抛', async () => {
  const calls = [];
  const result = await customStream({
    protocol: 'responses',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    extraTools: [{ type: 'function', name: 'workbench_dispatch', description: 'd', parameters: { type: 'object', properties: {} } }],
    managerIdle: true,
    fetcher: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return sseOk([
        { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'workbench_dispatch', call_id: 'call_1', arguments: '' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"prompt":"Grok, hi"}' },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'workbench_dispatch', call_id: 'call_1', arguments: '{"prompt":"Grok, hi"}' } },
      ]);
    },
  }, { messages: [{ role: 'user', content: 'Grok, hi' }] });
  assert.equal(calls[0].url, 'https://api.example.com/v1/responses');
  assert.ok((calls[0].body.tools || []).some(t => t.name === 'workbench_dispatch'));
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_1');
  assert.equal(result.toolCalls[0].name, 'workbench_dispatch');
  assert.equal(result.toolCalls[0].args.prompt, 'Grok, hi');
});

test('自定义 Responses 第二轮回写 function_call 与 function_call_output', async () => {
  const bodies = [];
  await customStream({
    protocol: 'responses',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    fetcher: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return sseOk([{ type: 'response.output_text.delta', delta: '已派给 Grok' }]);
    },
  }, {
    messages: [
      { role: 'user', content: 'Grok,写脚本' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'workbench_dispatch', args: { prompt: '写脚本', connectionId: 'Grok' } }],
        toolResults: [{ toolCallId: 'call_1', output: '{"ok":true,"status":"running"}' }],
      },
    ],
  });
  const types = bodies[0].input.map(item => item.type);
  assert.ok(types.includes('function_call'));
  assert.ok(types.includes('function_call_output'));
  const call = bodies[0].input.find(item => item.type === 'function_call');
  assert.equal(call.call_id, 'call_1');
  assert.equal(call.name, 'workbench_dispatch');
  const output = bodies[0].input.find(item => item.type === 'function_call_output');
  assert.equal(output.call_id, 'call_1');
});

test('自定义 OpenAI 按 index 拼 tool_calls，Anthropic 拼 tool_use', async () => {
  const openai = await customStream({
    protocol: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    fetcher: async () => sseOk([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_oa', type: 'function', function: { name: 'workbench_spawn_clone', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"prompt":"长规划"}' } }] } }] },
    ]),
  }, { messages: [{ role: 'user', content: '开分身' }] });
  assert.equal(openai.toolCalls[0].name, 'workbench_spawn_clone');
  assert.equal(openai.toolCalls[0].args.prompt, '长规划');

  const bodies = [];
  const claude = await customStream({
    protocol: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'claude-test',
    fetcher: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return sseOk([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'workbench_dispatch', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"prompt":"x"}' } },
      ]);
    },
  }, { messages: [{ role: 'user', content: '派 Grok' }] });
  assert.equal(claude.toolCalls[0].id, 'toolu_1');
  assert.equal(claude.toolCalls[0].args.prompt, 'x');

  await customStream({
    protocol: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'claude-test',
    fetcher: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return sseOk([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
    },
  }, {
    messages: [
      { role: 'user', content: '派 Grok' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'toolu_1', name: 'workbench_dispatch', args: { prompt: 'x' } }],
        toolResults: [{ toolCallId: 'toolu_1', output: '{"ok":true}' }],
      },
    ],
  });
  const second = bodies[1].messages;
  assert.ok(second.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use')));
  assert.ok(second.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')));
});

test('runTurn 流失败时仍落盘用户消息', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-persist-'));
  try {
    await assert.rejects(() => runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'claude-sonnet-5',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      workspace: dir,
      dataDir: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      transcript: { version: 1, vendor: 'custom', mode: 'default', messages: [], todos: [] },
      fetcher: async () => { throw new Error('upstream down'); },
      emit: () => {},
      userText: 'Grok,帮我创建一个简单的循环Python脚本',
      maxTurns: 2,
    }), /upstream down/);
    const saved = loadTranscript(dir, 's', 'manager', 'custom');
    assert.equal(saved.messages[0].role, 'user');
    assert.equal(saved.messages[0].content, 'Grok,帮我创建一个简单的循环Python脚本');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('管理者 custom Responses 执行 workbench_dispatch 并回写第二轮', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-disp-'));
  let calls = 0;
  const payloads = [];
  const dispatched = [];
  const clones = [];
  const fetcher = async (_url, init) => {
    calls += 1;
    payloads.push(JSON.parse(init.body));
    if (calls === 1) {
      return sseOk([
        { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'workbench_dispatch', call_id: 'call_1', arguments: '' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"connectionId":"Grok","prompt":"写一个循环脚本"}' },
        { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'workbench_dispatch', call_id: 'call_1', arguments: '{"connectionId":"Grok","prompt":"写一个循环脚本"}' } },
      ]);
    }
    return sseOk([{ type: 'response.output_text.delta', delta: '已派给 Grok' }]);
  };
  try {
    const result = await runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'claude-sonnet-5',
      apiKey: 'k',
      baseUrl: 'https://api.tyas.cc/v1',
      workspace: dir,
      dataDir: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      partitions: [],
      pool: [{ connectionId: 'official-grok', name: 'Grok', vendor: 'grok', vendorLabel: 'Grok', model: 'grok-4' }],
      transcript: { version: 1, vendor: 'custom', mode: 'default', messages: [], todos: [] },
      fetcher,
      emit: () => {},
      userText: 'Grok,帮我创建一个简单的循环Python脚本',
      maxTurns: 4,
      dispatchWork: spec => {
        dispatched.push(spec);
        return { ok: true, status: 'running', taskId: 't1', partitionId: 'p1', name: 'Grok' };
      },
      spawnClone: spec => {
        clones.push(spec);
        return { ok: true, status: 'running', taskId: 't2', partitionId: 'c1', slot: 1, name: '分身' };
      },
    });
    assert.equal(dispatched.length, 1);
    assert.equal(clones.length, 0);
    assert.equal(dispatched[0].connectionId, 'Grok');
    assert.match(dispatched[0].prompt, /循环脚本/);
    assert.match(result.text, /已派给 Grok/);
    assert.ok((payloads[0].tools || []).some(t => t.name === 'workbench_dispatch'));
    assert.ok((payloads[0].tools || []).some(t => t.name === 'workbench_spawn_clone'));
    assert.match(payloads[0].instructions, /MUST call workbench_dispatch/);
    const input = payloads[1].input;
    assert.ok(input.some(i => i.type === 'function_call' && i.call_id === 'call_1'));
    assert.ok(input.some(i => i.type === 'function_call_output' && i.call_id === 'call_1'));
    const saved = loadTranscript(dir, 's', 'manager', 'custom');
    assert.equal(saved.messages[0].role, 'user');
    assert.ok(saved.messages[1].toolCalls.some(t => t.name === 'workbench_dispatch'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude 分组管理者空闲只带 overlay，不含 Read/Write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-fam-mgr-'));
  let payload;
  try {
    await runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'claude-sonnet-5',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      connection: { id: 'c1', name: 'kiro', modelGroups: ['claude'], protocol: 'responses' },
      workspace: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      transcript: { version: 1, vendor: 'custom', mode: 'default', messages: [], todos: [] },
      fetcher: async (_url, init) => {
        payload = JSON.parse(init.body);
        return sseOk([{ type: 'response.output_text.delta', delta: '好' }]);
      },
      emit: () => {},
      userText: '你好',
      maxTurns: 2,
    });
    const names = (payload.tools || []).map(t => t.name);
    assert.ok(names.includes('workbench_dispatch'));
    assert.ok(!names.includes('Write'));
    assert.ok(!names.includes('Read'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude 分组自定义工人带系列工具并能写文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-fam-w-'));
  let tools;
  let calls = 0;
  const target = path.join(dir, 'loop.py');
  const fetcher = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (calls === 1) tools = body.tools;
    if (calls === 1) {
      return sseOk([{
        type: 'response.output_item.done',
        item: {
          id: 'fc_w',
          type: 'function_call',
          name: 'Write',
          call_id: 'call_w',
          arguments: JSON.stringify({ file_path: target, content: 'for i in range(3):\n    print(i)\n' }),
        },
      }]);
    }
    return sseOk([{ type: 'response.output_text.delta', delta: '已写好 loop.py' }]);
  };
  try {
    const result = await runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'claude-sonnet-5',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      connection: { id: 'c1', name: 'kiro', modelGroups: ['claude'], protocol: 'responses' },
      workspace: dir,
      sessionId: 's',
      targetId: 'p1',
      isManager: false,
      transcript: { version: 1, vendor: 'custom', mode: 'default', messages: [], todos: [] },
      fetcher,
      hitl: { request: async () => ({ approved: true, autoApproved: true }) },
      emit: () => {},
      userText: '写一个循环文件',
      maxTurns: 4,
    });
    const names = (tools || []).map(t => t.name);
    assert.ok(names.includes('Write'));
    assert.ok(names.includes('Read'));
    assert.ok(!names.includes('workbench_dispatch'));
    assert.match(fs.readFileSync(target, 'utf8'), /range\(3\)/);
    assert.match(result.text, /loop\.py/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('管理者 custom Responses 执行 workbench_spawn_clone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-clone-'));
  let calls = 0;
  const clones = [];
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) {
      return sseOk([{
        type: 'response.output_item.done',
        item: { id: 'fc_2', type: 'function_call', name: 'workbench_spawn_clone', call_id: 'call_2', arguments: '{"prompt":"整理刚才的方案"}' },
      }]);
    }
    return sseOk([{ type: 'response.output_text.delta', delta: '分身已开工' }]);
  };
  try {
    const result = await runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'm',
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      workspace: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      transcript: { version: 1, vendor: 'custom', mode: 'default', messages: [], todos: [] },
      fetcher,
      emit: () => {},
      userText: '开个分身整理方案',
      maxTurns: 4,
      spawnClone: spec => {
        clones.push(spec);
        return { ok: true, status: 'running', taskId: 't2', slot: 1, name: '分身 1' };
      },
    });
    assert.equal(clones.length, 1);
    assert.equal(clones[0].prompt, '整理刚才的方案');
    assert.match(result.text, /分身已开工/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 OpenAI 协议仍走 /chat/completions', async () => {
  const calls = [];
  const result = await customStream({
    protocol: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    fetcher: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({ choices: [{ message: { content: 'hi back' } }] });
        },
      };
    },
  }, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].body.stream, true);
  assert.equal(result.text, 'hi back');
});

test('工作区读写与 apply_patch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-io-'));
  try {
    writeWorkspaceFile(dir, 'a.txt', 'hello world');
    const read = readWorkspaceFile(dir, 'a.txt');
    assert.ok(read.ok && read.content.includes('hello world'));
    const replaced = replaceInFile(dir, 'a.txt', 'world', 'agents');
    assert.equal(replaced.replacements, 1);
    const grep = grepSearch(dir, 'agents');
    assert.equal(grep.matches.length, 1);
    const patch = applyPatch(dir, `*** Begin Patch\n*** Add File: b.txt\n+from patch\n*** End Patch`);
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8').trim(), 'from patch');
    assert.equal(patch.changed[0].op, 'add');
    assert.throws(() => writeWorkspaceFile(dir, path.resolve(dir, '..', 'escape.txt'), 'nope'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plan 模式拒绝写入，accept-edits 放行文件', () => {
  assert.equal(decidePermission({ vendor: 'agy', mode: 'plan', kind: 'write' }).action, 'deny');
  assert.equal(decidePermission({ vendor: 'agy', mode: 'accept-edits', kind: 'write' }).action, 'allow');
  assert.equal(decidePermission({ vendor: 'agy', mode: 'default', kind: 'write' }).action, 'ask');
  assert.equal(decidePermission({ vendor: 'claude', mode: 'default', kind: 'read' }).action, 'allow');
  assert.equal(normalizeMode('codex', 'nope'), 'on-request');
  assert.equal(normalizeMode('claude', 'manual'), 'default');
  assert.deepEqual(modeOptions('codex').map(item => item.id), ['on-request', 'on-failure', 'never', 'untrusted']);
  assert.ok(!modeOptions('claude').some(item => item.id === 'on-request' || item.id === 'manual'));
  assert.ok(modeOptions('agy').some(item => item.id === 'bypassPermissions'));
  assert.ok(!modeOptions('agy').some(item => item.id === 'never'));
  assert.ok(!modeOptions('grok').some(item => item.id === 'never'));
});

test('parseToolArgs 识别 apply_patch 原文和 exec_command', () => {
  assert.deepEqual(parseToolArgs('apply_patch', '', '*** Begin Patch\n*** End Patch'), { input: '*** Begin Patch\n*** End Patch' });
  assert.deepEqual(parseToolArgs('apply_patch', '*** Begin Patch', ''), { input: '*** Begin Patch' });
  assert.deepEqual(parseToolArgs('apply_patch', '{"input":"x"}', ''), { input: 'x' });
  assert.deepEqual(parseToolArgs('exec_command', '{"cmd":"dir"}', ''), { cmd: 'dir' });
  assert.deepEqual(parseToolArgs('exec_command', '', 'dir'), { cmd: 'dir' });
  assert.deepEqual(parseToolArgs('exec_command', '', ''), {});
});

test('官方 Gemini 工具结果用 user+functionResponse，不用 role function', () => {
  const contents = agyToContents([
    { role: 'user', content: '列出目录' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'list_dir', args: { DirectoryPath: 'C:\\x' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'list_dir', output: '循环示例.py' }],
    },
  ]);
  assert.ok(contents.every(c => c.role !== 'function'));
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model');
  assert.ok(contents[1].parts.some(p => p.functionCall?.name === 'list_dir'));
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[2].parts[0].functionResponse.name, 'list_dir');
  assert.match(String(contents[2].parts[0].functionResponse.response.output), /循环示例/);
});

test('官方 Gemini 第二轮 generateContent 不含 function 角色', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-agy-role-'));
  const bodies = [];
  let gen = 0;
  const fetcher = async (url, init) => {
    if (String(url).includes('loadCodeAssist')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, async text() { return '{}'; } };
    }
    gen += 1;
    if (init?.body) bodies.push(JSON.parse(init.body));
    if (gen === 1) {
      return sseOk([{
        response: { candidates: [{ content: { parts: [{ functionCall: { name: 'list_dir', args: { DirectoryPath: dir } } }] } }] },
      }]);
    }
    return sseOk([{
      response: { candidates: [{ content: { parts: [{ text: '目录里已有循环示例.py' }] } }] },
    }]);
  };
  try {
    const result = await runTurn({
      vendor: 'agy',
      model: 'gemini-3.8-flash',
      workspace: dir,
      sessionId: 's',
      targetId: 'p1',
      isManager: false,
      transcript: { version: 1, vendor: 'agy', mode: 'default', messages: [], todos: [] },
      accessToken: 'ya29.test',
      fetcher,
      emit: () => {},
      userText: '列出工作区',
      maxTurns: 4,
    });
    assert.match(result.text, /循环示例/);
    assert.ok(bodies.length >= 2);
    const second = bodies[1].request?.contents || bodies[1].contents || [];
    assert.ok(second.length);
    assert.ok(second.every(c => c.role !== 'function'));
    assert.ok(second.some(c => c.role === 'user' && c.parts?.[0]?.functionResponse));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('官方 Codex 等 arguments 拼完再交 exec_command', async () => {
  const live = [];
  const result = await codexStream({
    model: 'gpt-5.6-terra',
    accessToken: 't',
    accountID: 'a',
    timezone: '',
    fetcher: async () => sseOk([
      { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'exec_command', call_id: 'call_1', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"cmd":"dir"}' },
      { type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 0, arguments: '{"cmd":"dir"}' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'exec_command', call_id: 'call_1', arguments: '{"cmd":"dir"}' } },
    ]),
  }, { messages: [{ role: 'user', content: 'list' }], onToolCall: tc => live.push(tc) });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_1');
  assert.equal(result.toolCalls[0].args.cmd, 'dir');
  assert.equal(live.length, 1);
  assert.equal(live[0].args.cmd, 'dir');
});

test('官方 Codex apply_patch 走 custom_tool_call_input', async () => {
  const patch = '*** Begin Patch\n*** Add File: a.py\n+print(1)\n*** End Patch';
  const result = await codexStream({
    model: 'gpt-5.6-terra',
    accessToken: 't',
    accountID: 'a',
    timezone: '',
    fetcher: async () => sseOk([
      { type: 'response.output_item.added', output_index: 0, item: { id: 'ctc_1', type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_p', input: '' } },
      { type: 'response.custom_tool_call_input.delta', item_id: 'ctc_1', output_index: 0, delta: patch.slice(0, 10) },
      { type: 'response.custom_tool_call_input.delta', item_id: 'ctc_1', output_index: 0, delta: patch.slice(10) },
      { type: 'response.custom_tool_call_input.done', item_id: 'ctc_1', output_index: 0, input: patch },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'ctc_1', type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_p', input: patch } },
    ]),
  }, { messages: [{ role: 'user', content: '写文件' }] });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'apply_patch');
  assert.equal(result.toolCalls[0].args.input, patch);
});

test('空 apply_patch / exec_command 不弹 HITL', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-empty-tool-'));
  let hitl = 0;
  let calls = 0;
  try {
    await runTurn({
      vendor: 'codex',
      model: 'gpt-5.6-terra',
      workspace: dir,
      sessionId: 's',
      targetId: 'p1',
      isManager: false,
      connection: { id: 'official-codex' },
      transcript: { version: 1, vendor: 'codex', mode: 'on-request', messages: [], todos: [] },
      accessToken: 't',
      accountID: 'a',
      fetcher: async () => {
        calls += 1;
        if (calls === 1) {
          return sseOk([
            { type: 'response.output_item.added', item: { id: 'fc', type: 'function_call', name: 'apply_patch', call_id: 'c1', arguments: '' } },
            { type: 'response.output_item.done', item: { id: 'fc', type: 'function_call', name: 'apply_patch', call_id: 'c1', arguments: '' } },
          ]);
        }
        return sseOk([{ type: 'response.output_text.delta', delta: '缺少补丁内容' }]);
      },
      hitl: { request: async () => { hitl += 1; return { approved: true }; } },
      emit: () => {},
      userText: '写文件',
      maxTurns: 4,
    });
    assert.equal(hitl, 0);
    assert.ok(calls >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 Codex 分区权限模式走 Codex 而不是 custom', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-fam-mode-'));
  try {
    const conn = { id: 'codex-test', name: 'Codex测试1', modelGroups: ['codex'], protocol: 'responses' };
    const session = {
      id: 's',
      partitions: [{ id: 'p1', role: 'execution', routes: [{ connectionId: 'codex-test', model: 'gpt-5.6-terra' }] }],
    };
    const state = {
      projects: [{ sessions: [session] }],
      connections: [conn],
      manager: { connectionId: 'codex-test', model: 'gpt-5.6-terra' },
    };
    const hist = handleHistory({ dataDir: dir, state }, { sessionId: 's', partitionId: 'p1' });
    assert.equal(hist.vendor, 'codex');
    assert.equal(hist.mode, 'on-request');
    const cycled = handleMode({ dataDir: dir, state }, { sessionId: 's', partitionId: 'p1', vendor: 'custom', cycle: true });
    assert.equal(cycled.vendor, 'codex');
    assert.equal(cycled.mode, 'on-failure');
    const set = handleMode({ dataDir: dir, state }, { sessionId: 's', partitionId: 'p1', mode: 'never' });
    assert.equal(set.vendor, 'codex');
    assert.equal(set.mode, 'never');
    const rejected = handleMode({ dataDir: dir, state }, { sessionId: 's', partitionId: 'p1', mode: 'bypassPermissions' });
    assert.equal(rejected.mode, 'on-request');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 Responses apply_patch 拼 custom_tool_call_input', async () => {
  const patch = '*** Begin Patch\n*** Add File: b.py\n+print(2)\n*** End Patch';
  const result = await customStream({
    protocol: 'responses',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    fetcher: async () => sseOk([
      { type: 'response.output_item.added', output_index: 0, item: { id: 'ctc_1', type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_p', input: '' } },
      { type: 'response.custom_tool_call_input.delta', item_id: 'ctc_1', output_index: 0, delta: patch },
      { type: 'response.custom_tool_call_input.done', item_id: 'ctc_1', output_index: 0, input: patch },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'ctc_1', type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_p', input: patch } },
    ]),
  }, { messages: [{ role: 'user', content: '写' }] });
  assert.equal(result.toolCalls[0].name, 'apply_patch');
  assert.equal(result.toolCalls[0].args.input, patch);
});

test('管理者 Grok 回合只带 overlay，不含原生工具', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-mgr-'));
  let payload;
  const fetcher = async (_url, init) => {
    payload = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      async text() {
        return 'data: {"choices":[{"delta":{"content":"收到"}}]}\n\n';
      },
    };
  };
  try {
    const result = await runTurn({
      vendor: 'grok',
      model: 'grok-4',
      workspace: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      partitions: [],
      connection: { id: 'official-grok' },
      pool: [{ connectionId: 'official-grok', name: 'Grok', vendor: 'grok', vendorLabel: 'Grok', model: 'grok-4' }],
      transcript: { version: 1, vendor: 'grok', mode: 'default', messages: [], todos: [] },
      accessToken: 'x',
      fetcher,
      emit: () => {},
      userText: '你好',
      maxTurns: 2,
    });
    assert.match(result.text, /收到/);
    const names = (payload.tools || []).map(t => t.function?.name);
    assert.ok(names.includes('workbench_dispatch'));
    assert.ok(names.includes('workbench_spawn_clone'));
    assert.ok(names.includes('workbench_list_targets'));
    assert.ok(!names.includes('read_file'));
    assert.ok(!names.includes('run_terminal_command'));
    const system = payload.messages?.[0]?.content || '';
    assert.match(system, /You currently ARE Grok/);
    assert.match(system, /grok-4/);
    assert.match(system, /previous manager actor/);
    assert.match(system, /Never claim a pool entry/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义 Grok 管理者身份不跟能力池里的 Claude 型号走', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-mgr-id-'));
  let payload;
  const fetcher = async (_url, init) => {
    payload = JSON.parse(init.body);
    return sseOk([{ type: 'response.output_text.delta', delta: '我是 Grok' }]);
  };
  try {
    const result = await runTurn({
      vendor: 'custom',
      protocol: 'responses',
      model: 'grok-4.6',
      effort: 'xhigh',
      apiKey: 'k',
      baseUrl: 'https://api.tyas.cc/v1',
      workspace: dir,
      dataDir: dir,
      sessionId: 's',
      targetId: 'manager',
      isManager: true,
      partitions: [],
      connection: { id: 'g1', name: 'Grok-测试', modelGroups: ['grok'], protocol: 'responses' },
      pool: [
        { connectionId: 'kiro', name: 'kiro', vendor: 'custom', vendorLabel: 'Claude', groupLabel: 'Claude', model: 'claude-sonnet-5' },
        { connectionId: 'g1', name: 'Grok-测试', vendor: 'custom', vendorLabel: 'Grok', groupLabel: 'Grok', model: 'grok-4.6' },
      ],
      transcript: {
        version: 1,
        vendor: 'grok',
        mode: 'default',
        messages: [{ role: 'assistant', content: '我是 Claude，当前模型是 claude-sonnet-5。', model: 'claude-sonnet-5' }],
        todos: [],
      },
      fetcher,
      emit: () => {},
      userText: '你现在的模型是什么？',
      maxTurns: 2,
    });
    assert.match(result.text, /Grok/);
    const instructions = payload.instructions || '';
    assert.match(instructions, /You currently ARE Grok/);
    assert.match(instructions, /Current model id: grok-4\.6/);
    assert.match(instructions, /Effort: xhigh \(极高\)/);
    assert.match(instructions, /previous manager actor/);
    assert.match(instructions, /Never claim a pool entry/);
    assert.match(instructions, /claude-sonnet-5/);
    assert.match(instructions, /Vendor harness: grok/);
    assert.match(instructions, /Model: grok-4\.6/);
    assert.doesNotMatch(instructions, /You currently ARE Claude/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('transcript 旁路存储不进 workspace.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-tr-'));
  try {
    const t = loadTranscript(dir, 's1', 'manager', 'agy');
    t.messages.push({ id: 'm', role: 'user', content: 'hi', timestamp: new Date().toISOString() });
    saveTranscript(dir, 's1', 'manager', t);
    const loaded = loadTranscript(dir, 's1', 'manager', 'agy');
    assert.equal(loaded.messages[0].content, 'hi');
    const pub = publicTranscript(loaded);
    assert.equal(pub.vendor, 'agy');
    assert.ok(!fs.existsSync(path.join(dir, 'workspace.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agy 循环会带上 view_file 工具并回传结果', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-loop-'));
  fs.writeFileSync(path.join(dir, 'README.md'), 'workbench');
  let calls = 0;
  const events = [];
  const fetcher = async (url) => {
    if (String(url).includes('loadCodeAssist')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, async text() { return '{}'; } };
    }
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        async text() {
          return `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ functionCall: { name: 'view_file', args: { AbsolutePath: path.join(dir, 'README.md') } } }] } }] } })}\n\n`;
        },
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      async text() {
        return `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: '已读到 README' }] } }] } })}\n\n`;
      },
    };
  };
  try {
    const result = await runTurn({
      vendor: 'agy',
      model: 'gemini-3.8-flash-medium',
      workspace: dir,
      timezone: 'Asia/Tokyo',
      sessionId: 's',
      targetId: 'manager',
      transcript: { version: 1, vendor: 'agy', mode: 'default', messages: [], todos: [] },
      accessToken: 'ya29.test',
      fetcher,
      hitl: { request: async () => ({ approved: true, autoApproved: true }) },
      emit: (event, data) => events.push({ event, data }),
      userText: 'read the readme',
      maxTurns: 4,
    });
    assert.match(result.text, /README/);
    assert.equal(calls, 2);
    assert.ok(events.some(e => e.event === 'tool_call' && e.data.name === 'view_file'));
    assert.ok(events.some(e => e.event === 'tool_result'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { once } from 'node:events';
import { spawn } from 'node:child_process';

test('/api/chat 与 /api/test 分开，缺会话拒绝，不把 test 扩成聊天', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-chat-'));
  const env = { ...process.env, PORT: '0', AGENTS_DESKTOP: '1', AGENTS_DATA_DIR: dir, MULTI_AGENT_SECRETS: path.join(dir, 'secrets') };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({
    projects: [{ id: 'p', name: 'p', path: dir, sessions: [{ id: 's', name: 's', partitions: [], timezone: 'Asia/Tokyo' }] }],
    connections: [],
  }));
  const child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const stop = async () => {
    if (child.exitCode === null) {
      const done = once(child, 'exit');
      child.stdin.end();
      await done;
    }
  };
  try {
    const [data] = await once(child.stdout, 'data');
    const address = data.toString().trim().replace('AGENTS_READY ', '');
    const headers = { Origin: address, 'Content-Type': 'application/json' };
    const missing = await fetch(address + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: 'nope', text: 'hi' }) });
    assert.equal(missing.status, 400);
    const noManager = await fetch(address + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: 's', text: 'hi' }) });
    assert.equal(noManager.status, 400);
    const noManagerBody = await noManager.json();
    assert.match(noManagerBody.error, /管理者/);
    const testStill = await fetch(address + '/api/test', { method: 'POST', headers, body: JSON.stringify({ id: 'missing', model: 'x' }) });
    assert.equal(testStill.status, 400);
    const chatJs = await fetch(address + '/chat.js');
    assert.equal(chatJs.status, 200);
    const history = await fetch(address + '/api/chat/history', { method: 'POST', headers, body: JSON.stringify({ sessionId: 's' }) });
    assert.equal(history.status, 200);
    const hist = await history.json();
    assert.equal(hist.target, 'manager');
    assert.ok(Array.isArray(hist.messages));
    const seeded = await (await fetch(address + '/api/state')).json();
    const mgr = seeded.projects[0].sessions[0].partitions.find(p => p.role === 'manager');
    assert.equal(mgr.name, '管理者AI');
    const mgrHist = await fetch(address + '/api/chat/history', { method: 'POST', headers, body: JSON.stringify({ sessionId: 's', partitionId: mgr.id }) });
    assert.equal(mgrHist.status, 200);
    assert.equal((await mgrHist.json()).target, 'manager');
    const groupHist = await fetch(address + '/api/group/history', { method: 'POST', headers, body: JSON.stringify({ sessionId: 's' }) });
    assert.equal(groupHist.status, 200);
    const groupBody = await groupHist.json();
    assert.ok(Array.isArray(groupBody.events));
    const ac = new AbortController();
    const live = await fetch(address + '/api/session/events?sessionId=s', { signal: ac.signal });
    assert.equal(live.status, 200);
    assert.match(String(live.headers.get('content-type') || ''), /text\/event-stream/);
    const reader = live.body.getReader();
    const firstChunk = await reader.read();
    const sseText = new TextDecoder().decode(firstChunk.value || new Uint8Array());
    assert.match(sseText, /group_timeline/);
    ac.abort();
    try { await reader.cancel(); } catch { /* closed */ }
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HITL 必须显式允许或拒绝，缺省不放行', () => {
  assert.throws(() => handleHitl({ approvalId: 'missing' }), /审批不存在|请明确允许或拒绝/);
  assert.throws(() => handleHitl({ approvalId: 'x', approved: undefined }), /请明确允许或拒绝|审批不存在/);
});
