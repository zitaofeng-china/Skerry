import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveSecret } from './secret-store.mjs';
import {
  CLAUDE_MESSAGES_URL,
  CLAUDE_MODELS_URL,
  CLAUDE_OAUTH_BETA,
  CODEX_CLI_VERSION,
  CODEX_MODELS_URL,
  CODEX_RESPONSES_URL,
  ANTIGRAVITY_USER_AGENT,
  GEMINI_GENERATE_PATH,
  GEMINI_LOAD_PATH,
  GEMINI_MODELS_BASES,
  GEMINI_MODELS_PATH,
  GEMINI_STREAM_PATH,
  GROK_CHAT_URL,
  GROK_MODELS_URL,
  fetchModelCatalog,
  fetchOfficialModels,
  modelUrlCandidates,
  parseModelPayload,
  TEST_PROMPT,
  testOfficialModel,
} from './model-fetch.mjs';
import { CODEX_CLI_ORIGINATOR, CODEX_CLI_USER_AGENT } from './official-client-http.mjs';
import { JAPAN_TIMEZONE, convertJsonDatetimes, localTimeZone } from './session-timezone.mjs';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload); },
  };
}

test('模型列表候选地址按 CC Switch 规则展开', () => {
  assert.deepEqual(modelUrlCandidates('https://api.siliconflow.cn/v1'), ['https://api.siliconflow.cn/v1/models']);
  assert.deepEqual(modelUrlCandidates('https://api.example.com'), ['https://api.example.com/v1/models']);
  assert.deepEqual(modelUrlCandidates('https://open.bigmodel.cn/api/paas/v4'), [
    'https://open.bigmodel.cn/api/paas/v4/models',
    'https://open.bigmodel.cn/api/paas/v4/v1/models',
  ]);
  assert.deepEqual(modelUrlCandidates('https://api.deepseek.com/anthropic'), [
    'https://api.deepseek.com/anthropic/v1/models',
    'https://api.deepseek.com/v1/models',
    'https://api.deepseek.com/models',
  ]);
});

test('解析 OpenAI / Codex / Claude / Gemini 列表载荷', () => {
  assert.deepEqual(parseModelPayload({
    data: [
      { id: 'gpt-4o', owned_by: 'openai' },
      { id: 'gpt-4o' },
    ],
  }).map(m => m.id), ['gpt-4o']);

  const codex = parseModelPayload({
    models: [
      {
        slug: 'gpt-5.4',
        display_name: 'GPT-5.4',
        max_context_window: 272000,
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }, { effort: 'nope' }],
        default_reasoning_level: 'low',
      },
      'gpt-5.5',
    ],
  }, 'codex');
  assert.equal(codex[0].id, 'gpt-5.4');
  assert.equal(codex[0].displayName, 'GPT-5.4');
  assert.equal(codex[0].contextWindow, 272000);
  assert.deepEqual(codex[0].reasoningLevels, ['low', 'xhigh']);
  assert.equal(codex[0].defaultReasoningLevel, 'low');
  assert.equal(codex[1].id, 'gpt-5.5');
  assert.equal(codex[1].ownedBy, 'Codex');

  const claude = parseModelPayload({
    data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }],
  }, 'claude');
  assert.equal(claude[0].displayName, 'Claude Sonnet 4.5');
  assert.equal(claude[0].ownedBy, 'Anthropic');

  const gemini = parseModelPayload({
    models: {
      'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro', maxTokens: 1048576, model: 'MODEL_GOOGLE_GEMINI_2_5_PRO' },
      'gemini-2.5-flash': { displayName: 'Gemini 3.5 Flash Lite', maxTokens: 1048576, model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH' },
      chat_20706: { displayName: 'internal' },
      MODEL_PLACEHOLDER_M16: { displayName: 'placeholder' },
      'models/gemini-2.5-flash-lite': { displayName: 'Gemini 2.5 Flash Lite' },
    },
  }, 'gemini');
  assert.deepEqual(gemini.map(m => m.id), ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
  assert.equal(gemini[2].contextWindow, 1048576);
  assert.equal(gemini[2].displayName, 'Gemini 2.5 Pro');
  assert.equal(gemini[2].ownedBy, 'Google');
  assert.equal(gemini.find(m => m.id === 'gemini-2.5-flash').displayName, undefined);
  assert.equal(gemini.find(m => m.id === 'gemini-2.5-flash-lite').displayName, 'Gemini 2.5 Flash Lite');
});

test('Gemini 按 Antigravity 型号分组，努力程度收到思考等级', () => {
  const grouped = parseModelPayload({
    agentModelSorts: [{
      groups: [{
        modelIds: [
          'gemini-3.8-flash-high',
          'gemini-3.8-flash-medium',
          'gemini-3.8-flash-low',
          'gemini-pro-agent',
          'gemini-3.1-pro-low',
          'claude-sonnet-4-6',
        ],
      }],
    }],
    models: {
      'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1048576 },
      'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash (Medium)', maxTokens: 1048576 },
      'gemini-3.8-flash-low': { displayName: 'Gemini 3.8 Flash (Low)', maxTokens: 1048576 },
      'gemini-3.8-flash-tiered': { maxTokens: 1048576 },
      'gemini-3.5-flash-extra-low': { displayName: 'Gemini 3.5 Flash (Low)', maxTokens: 1048576 },
      'gemini-3.5-flash-low': { displayName: 'Gemini 3.5 Flash (Medium)', maxTokens: 1048576 },
      'gemini-3-flash-agent': { displayName: 'Gemini 3.5 Flash (High)', maxTokens: 1048576 },
      'gemini-3.5-flash-lite': { displayName: 'Gemini 3.5 Flash Lite', maxTokens: 1048576 },
      'gemini-pro-agent': { displayName: 'Gemini 3.1 Pro (High)', maxTokens: 1048576 },
      'gemini-3.1-pro-high': { displayName: 'Gemini 3.1 Pro (High)', maxTokens: 1048576 },
      'gemini-3.1-pro-low': { displayName: 'Gemini 3.1 Pro (Low)', maxTokens: 1048576 },
      'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6 (Thinking)', maxTokens: 250000 },
      chat_20706: { displayName: 'internal' },
    },
  }, 'gemini');

  assert.deepEqual(grouped.map(m => m.id), [
    'gemini-3.8-flash',
    'gemini-3.1-pro',
    'claude-sonnet-4-6',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
  ]);
  const flash = grouped.find(m => m.id === 'gemini-3.8-flash');
  assert.equal(flash.displayName, 'Gemini 3.8 Flash');
  assert.deepEqual(flash.reasoningLevels, ['low', 'medium', 'high']);
  assert.equal(flash.defaultReasoningLevel, 'medium');
  assert.deepEqual(flash.effortModels, {
    low: 'gemini-3.8-flash-low',
    medium: 'gemini-3.8-flash-medium',
    high: 'gemini-3.8-flash-high',
  });
  const flash35 = grouped.find(m => m.id === 'gemini-3.5-flash');
  assert.equal(flash35.displayName, 'Gemini 3.5 Flash');
  assert.deepEqual(flash35.effortModels, {
    low: 'gemini-3.5-flash-extra-low',
    medium: 'gemini-3.5-flash-low',
    high: 'gemini-3-flash-agent',
  });
  const pro = grouped.find(m => m.id === 'gemini-3.1-pro');
  assert.deepEqual(pro.reasoningLevels, ['low', 'high']);
  assert.equal(pro.defaultReasoningLevel, 'high');
  assert.equal(pro.effortModels.high, 'gemini-3.1-pro-high');
  assert.equal(pro.effortModels.low, 'gemini-3.1-pro-low');
  assert.equal(grouped.find(m => m.id === 'gemini-3.5-flash-lite').reasoningLevels, undefined);
  assert.equal(grouped.find(m => /tiered/.test(m.id)), undefined);
});

test('官方 Codex 使用 chatgpt backend 列表并带账号头', async () => {
  const calls = [];
  const models = await fetchOfficialModels('official-codex', {
    accessToken: 'codex-at',
    accountID: 'acct_codex',
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ models: [{ slug: 'gpt-5.4', display_name: 'GPT-5.4' }] });
    },
  });
  assert.equal(models[0].id, 'gpt-5.4');
  assert.equal(calls[0].url, `${CODEX_MODELS_URL}?client_version=${CODEX_CLI_VERSION}`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer codex-at');
  assert.equal(calls[0].init.headers['chatgpt-account-id'], 'acct_codex');
  assert.equal(calls[0].init.headers.Originator, CODEX_CLI_ORIGINATOR);
  assert.equal(calls[0].init.headers.version, CODEX_CLI_VERSION);
  assert.equal(calls[0].init.headers['User-Agent'], CODEX_CLI_USER_AGENT);
  await assert.rejects(
    () => fetchOfficialModels('official-codex', { accessToken: 'codex-at', fetcher: async () => jsonResponse({}) }),
    /官方账号信息不完整/,
  );
});

test('官方 Claude / Grok / Gemini 走各自列表接口', async () => {
  const claudeCalls = [];
  const claude = await fetchOfficialModels('official-claude', {
    accessToken: 'claude-at',
    fetcher: async (url, init) => {
      claudeCalls.push({ url, init });
      if (url.includes('after_id=')) {
        return jsonResponse({ data: [{ id: 'claude-haiku-4-5', display_name: 'Haiku' }], has_more: false });
      }
      return jsonResponse({
        data: [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }],
        has_more: true,
        last_id: 'claude-sonnet-4-5',
      });
    },
  });
  assert.equal(claudeCalls[0].url, `${CLAUDE_MODELS_URL}?limit=1000`);
  assert.equal(claudeCalls[0].init.headers['anthropic-beta'], CLAUDE_OAUTH_BETA);
  assert.equal(claudeCalls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(claudeCalls[1].url, `${CLAUDE_MODELS_URL}?limit=1000&after_id=claude-sonnet-4-5`);
  assert.deepEqual(claude.map(m => m.id), ['claude-haiku-4-5', 'claude-sonnet-4-5']);

  const grok = await fetchOfficialModels('official-grok', {
    accessToken: 'grok-at',
    fetcher: async (url, init) => {
      assert.equal(url, GROK_MODELS_URL);
      assert.equal(init.headers.Authorization, 'Bearer grok-at');
      return jsonResponse({ data: [{ id: 'grok-3', owned_by: 'xai' }] });
    },
  });
  assert.equal(grok[0].id, 'grok-3');

  const geminiUrls = [];
  const gemini = await fetchOfficialModels('official-gemini', {
    accessToken: 'ya29.at',
    fetcher: async (url, init) => {
      geminiUrls.push(url);
      if (url.endsWith(GEMINI_LOAD_PATH)) {
        assert.equal(init.body, JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }));
        assert.equal(init.headers['User-Agent'], ANTIGRAVITY_USER_AGENT);
        return jsonResponse({ cloudaicompanionProject: 'proj-1' });
      }
      if (url.startsWith(GEMINI_MODELS_BASES[0]) && url.endsWith(GEMINI_MODELS_PATH)) {
        return jsonResponse('missing', 404);
      }
      assert.equal(init.method, 'POST');
      assert.equal(init.body, JSON.stringify({ project: 'proj-1' }));
      assert.equal(init.headers.Authorization, 'Bearer ya29.at');
      return jsonResponse({ models: { 'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro', maxTokens: 1048576 } } });
    },
  });
  assert.equal(geminiUrls[0], `${GEMINI_MODELS_BASES[0]}${GEMINI_LOAD_PATH}`);
  assert.equal(geminiUrls[1], `${GEMINI_MODELS_BASES[0]}${GEMINI_MODELS_PATH}`);
  assert.equal(geminiUrls[2], `${GEMINI_MODELS_BASES[1]}${GEMINI_LOAD_PATH}`);
  assert.equal(gemini[0].id, 'gemini-2.5-pro');
  assert.equal(gemini[0].contextWindow, 1048576);
});

test('自定义供应商按协议拉取 /v1/models', async () => {
  const models = await fetchModelCatalog(
    { protocol: 'openai', baseUrl: 'https://api.example.com/v1' },
    'sk-test',
    async (url, init) => {
      assert.equal(url, 'https://api.example.com/v1/models');
      assert.equal(init.headers.Authorization, 'Bearer sk-test');
      return jsonResponse({ data: [{ id: 'proxy-model', owned_by: 'acme' }] });
    },
  );
  assert.equal(models[0].id, 'proxy-model');
  assert.equal(models[0].ownedBy, 'acme');
});

test('未登录官方账号时 /api/models 拒绝拉取', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-models-official-'));
  const env = { ...process.env, PORT: '0', AGENTS_DESKTOP: '1', AGENTS_DATA_DIR: dir, MULTI_AGENT_SECRETS: path.join(dir, 'secrets') };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({ projects: [], connections: [] }));
  let child;
  try {
    child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const [data] = await once(child.stdout, 'data');
    const address = data.toString().trim().replace('AGENTS_READY ', '');
    const res = await fetch(address + '/api/models', {
      method: 'POST',
      headers: { Origin: address, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'official-codex' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /登录官方账号|重新登录/);
  } finally {
    if (child?.exitCode === null) {
      const done = once(child, 'exit');
      child.stdin.end();
      await done;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('自定义供应商 /api/models 拉取但不写入已配置模型列表', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-models-custom-'));
  const env = { ...process.env, PORT: '0', AGENTS_DESKTOP: '1', AGENTS_DATA_DIR: dir, MULTI_AGENT_SECRETS: path.join(dir, 'secrets') };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({
    projects: [],
    connections: [{
      id: 'conn-models',
      name: '本地模型源',
      protocol: 'openai',
      baseUrl: 'pending',
      models: [],
      modelGroups: ['codex'],
    }],
  }));
  saveSecret('conn-models', 'sk-local', env);

  const upstream = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models' && req.headers.authorization === 'Bearer sk-local') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'live-a', owned_by: 'local' }, { id: 'live-b' }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', () => {
      upstream.off('error', reject);
      resolve();
    });
  });
  const upstreamPort = upstream.address().port;
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
  disk.connections[0].baseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(disk));

  let child;
  try {
    child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const [data] = await once(child.stdout, 'data');
    const address = data.toString().trim().replace('AGENTS_READY ', '');
    const res = await fetch(address + '/api/models', {
      method: 'POST',
      headers: { Origin: address, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'conn-models' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.models, ['live-a', 'live-b']);
    assert.equal(body.catalog[0].ownedBy, 'local');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
    assert.deepEqual(saved.connections[0].models, []);
  } finally {
    if (child?.exitCode === null) {
      const done = once(child, 'exit');
      child.stdin.end();
      await done;
    }
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('官方连通检测按厂商发送最小模型请求并读取返回', async () => {
  const geminiCalls = [];
  const gemini = await testOfficialModel('official-gemini', {
    accessToken: 'ya29.at',
    model: 'gemini-3.8-flash-medium',
    fetcher: async (url, init) => {
      geminiCalls.push({ url, init });
      if (url.endsWith(GEMINI_LOAD_PATH)) {
        assert.equal(init.headers['User-Agent'], ANTIGRAVITY_USER_AGENT);
        return jsonResponse({ cloudaicompanionProject: 'proj-1' });
      }
      if (url === `${GEMINI_MODELS_BASES[0]}${GEMINI_STREAM_PATH}`) {
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'gemini-3.8-flash-medium');
        assert.equal(body.project, 'proj-1');
        assert.equal(body.requestType, 'agent');
        assert.equal(body.request.contents[0].parts[0].text, TEST_PROMPT);
        assert.equal(TEST_PROMPT, 'hi');
        assert.equal(init.headers.Accept, 'text/event-stream');
        return {
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          async text() {
            return 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}}\n\n';
          },
        };
      }
      return jsonResponse('missing', 404);
    },
  });
  assert.equal(gemini.message, '模型请求成功');
  assert.equal(gemini.preview, 'OK');
  assert.equal(geminiCalls[0].url, `${GEMINI_MODELS_BASES[0]}${GEMINI_LOAD_PATH}`);
  assert.equal(geminiCalls[1].url, `${GEMINI_MODELS_BASES[0]}${GEMINI_STREAM_PATH}`);

  const claudeCalls = [];
  const claude = await testOfficialModel('official-claude', {
    accessToken: 'claude-at',
    model: 'claude-sonnet-4-5[1M]',
    fetcher: async (url, init) => {
      claudeCalls.push({ url, init });
      const body = JSON.parse(init.body);
      assert.equal(url, CLAUDE_MESSAGES_URL);
      assert.equal(init.headers['anthropic-beta'], CLAUDE_OAUTH_BETA);
      assert.equal(body.model, 'claude-sonnet-4-5');
      assert.equal(body.messages[0].content, 'hi');
      return jsonResponse({ content: [{ type: 'text', text: 'OK' }] });
    },
  });
  assert.equal(claude.preview, 'OK');
  assert.equal(claudeCalls.length, 1);

  const grok = await testOfficialModel('official-grok', {
    accessToken: 'grok-at',
    model: 'grok-3',
    fetcher: async (url, init) => {
      assert.equal(url, GROK_CHAT_URL);
      assert.equal(init.headers.Authorization, 'Bearer grok-at');
      assert.equal(JSON.parse(init.body).messages[0].content, 'hi');
      return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
    },
  });
  assert.equal(grok.preview, 'OK');

  const tokyoStamp = '2026-09-16T16:00:00+09:00';
  const zoned = await testOfficialModel('official-grok', {
    accessToken: 'grok-at',
    model: 'grok-3',
    timezone: JAPAN_TIMEZONE,
    fetcher: async (_url, init) => {
      assert.equal(JSON.parse(init.body).messages[0].content, 'hi');
      return jsonResponse({
        choices: [{ message: { content: tokyoStamp, created: tokyoStamp } }],
      });
    },
  });
  const localStamp = convertJsonDatetimes(tokyoStamp, JAPAN_TIMEZONE, localTimeZone());
  assert.equal(zoned.preview, localStamp);

  const codexCalls = [];
  const codex = await testOfficialModel('official-codex', {
    accessToken: 'codex-at',
    accountID: 'acct_codex',
    model: 'gpt-5.4',
    effort: 'medium',
    fetcher: async (url, init) => {
      codexCalls.push({ url, init });
      const body = JSON.parse(init.body);
      assert.equal(url, CODEX_RESPONSES_URL);
      assert.equal(init.headers.Originator, CODEX_CLI_ORIGINATOR);
      assert.equal(init.headers['chatgpt-account-id'], 'acct_codex');
      assert.equal(body.model, 'gpt-5.4');
      assert.equal(body.reasoning.effort, 'medium');
      assert.equal(body.stream, true);
      assert.equal(body.input[0].content[0].text, 'hi');
      assert.equal(init.headers.Accept, 'text/event-stream');
      return jsonResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    },
  });
  assert.equal(codex.preview, 'OK');
  assert.equal(codexCalls.length, 1);

  const sse = await testOfficialModel('official-codex', {
    accessToken: 'codex-at',
    accountID: 'acct_codex',
    model: 'gpt-5.4',
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      async text() {
        return 'event: response.created\ndata: {"type":"response.created"}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n';
      },
    }),
  });
  assert.equal(sse.preview, 'OK');

  await assert.rejects(
    () => testOfficialModel('official-codex', { accessToken: 'codex-at', model: 'gpt-5.4', fetcher: async () => jsonResponse({}) }),
    /官方账号信息不完整/,
  );
  await assert.rejects(
    () => testOfficialModel('official-gemini', { accessToken: 'ya29.at', model: 'gemini-3.8-flash', fetcher: async () => jsonResponse({ candidates: [] }) }),
    /未返回有效模型内容/,
  );

  const geminiFallback = await testOfficialModel('official-gemini', {
    accessToken: 'ya29.at',
    model: 'gemini-3.8-flash-medium',
    fetcher: async (url) => {
      if (url.endsWith(GEMINI_LOAD_PATH)) return jsonResponse({ cloudaicompanionProject: 'proj-1' });
      if (url === `${GEMINI_MODELS_BASES[0]}${GEMINI_STREAM_PATH}`) return jsonResponse({ error: 'no stream' }, 404);
      if (url === `${GEMINI_MODELS_BASES[0]}${GEMINI_GENERATE_PATH}`) {
        return jsonResponse({ response: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } });
      }
      return jsonResponse('missing', 404);
    },
  });
  assert.equal(geminiFallback.preview, 'OK');
});

test('未登录官方账号时 /api/test 拒绝连通检测', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-official-'));
  const env = { ...process.env, PORT: '0', AGENTS_DESKTOP: '1', AGENTS_DATA_DIR: dir, MULTI_AGENT_SECRETS: path.join(dir, 'secrets') };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({ projects: [], connections: [] }));
  let child;
  try {
    child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const [data] = await once(child.stdout, 'data');
    const address = data.toString().trim().replace('AGENTS_READY ', '');
    const res = await fetch(address + '/api/test', {
      method: 'POST',
      headers: { Origin: address, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'official-gemini', model: 'gemini-3.8-flash-medium' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /登录官方账号/);
  } finally {
    if (child?.exitCode === null) {
      const done = once(child, 'exit');
      child.stdin.end();
      await done;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
