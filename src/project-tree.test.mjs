import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const chatJs = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/shell.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

test('项目行含省略号菜单和右侧编辑开新会话，点击项目展开会话再点会话看 AI', () => {
  assert.match(app, /data-action="project-menu"/);
  assert.match(app, /data-action="new-session"/);
  assert.match(app, /aria-label="项目菜单"/);
  assert.match(app, /aria-label="新建会话"/);
  assert.match(app, /function projectMenuItems/);
  assert.match(app, /function sessionRow/);
  assert.match(app, /取消置顶':'置顶/);
  assert.match(app, />编辑</);
  assert.match(app, /在访达 \/ 资源管理器中打开/);
  assert.match(app, /data-action="relocate-project"/);
  assert.match(app, />归档聊天</);
  assert.match(app, />移除项目</);
  assert.match(app, /class="session-item"/);
  assert.match(app, /sessions ai-list/);
  assert.match(app, /data-session="\$\{s\.id\}"/);
  assert.match(app, /管理者AI/);
  assert.match(app, /function groupChatPanel/);
  assert.match(app, /workerChatId/);
  assert.match(app, /isClonePart/);
  assert.match(app, /listedParts/);
  assert.match(app, /loadGroupHistory/);
  assert.match(app, /open-task/);
  assert.match(app, /back-to-group/);
  assert.match(app, /session_update/);
  assert.match(app, /viewingManager/);
  assert.match(chatJs, /data-task-box/);
  assert.match(chatJs, /data-scope="group"/);
  assert.match(chatJs, /type === 'note'/);
  assert.match(app, /listedParts\(s\)/);
  assert.doesNotMatch(app, /＋ 添加 AI 分区/);
  assert.doesNotMatch(app, /＋ 新建会话/);
  assert.match(server, /ensureManagerPartition/);
  assert.doesNotMatch(app, /treePrimed/);
  assert.doesNotMatch(app, /for\(const p of state\.projects\) open\.add\(p\.id\)/);
  assert.match(app, /data-action="pin-project"/);
  assert.match(app, /data-action="rename-project"/);
  assert.match(app, /data-action="reveal-project"/);
  assert.match(app, /data-action="archive-project"/);
  assert.match(app, /data-action="remove-project"/);
  assert.match(shell, /more:/);
  assert.match(shell, /archive:/);
  assert.match(css, /\.project-menu\{/);
  assert.match(css, /\.tree-icon-btn/);
  assert.match(css, /\.tree-row-actions/);
  assert.match(server, /\/api\/project\/pin/);
  assert.match(server, /\/api\/project\/rename/);
  assert.match(server, /\/api\/project\/reveal/);
  assert.match(server, /explorer\.exe/);
  assert.match(server, /\/api\/project\/archive/);
  assert.match(server, /\/api\/project\/remove/);
  assert.match(server, /uniqueSessionName/);
});

async function withServer(seed, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-tree-'));
  const env = {
    ...process.env,
    PORT: '0',
    AGENTS_DESKTOP: '1',
    AGENTS_DATA_DIR: dir,
    MULTI_AGENT_SECRETS: path.join(dir, 'secrets'),
  };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(seed));
  const child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const [data] = await once(child.stdout, 'data');
    const address = data.toString().trim().replace('AGENTS_READY ', '');
    const post = (endpoint, body) => fetch(address + endpoint, {
      method: 'POST',
      headers: { Origin: address, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await fn({ address, post, dir });
  } finally {
    if (child.exitCode === null) {
      const done = once(child, 'exit');
      child.stdin.end();
      await done;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('点击会话：未进群聊则进入并展开 AI 列表，已在群聊再点则只开关列表', () => {
  assert.match(app, /function inGroupChat\(sessionId\)\{\s*return selectedSession===sessionId && page==='workspace' && !selectedPartition;/s);
  assert.match(app, /function setSessionListOpen\(sessionId, shouldOpen, details\)/);
  assert.match(app, /if\(shouldOpen\) open\.add\(sessionId\);\s*else open\.delete\(sessionId\)/s);
  assert.match(app, /if\(inGroupChat\(id\)\)\{\s*const next=details\? !details\.open : !open\.has\(id\);\s*setSessionListOpen\(id, next, details\);\s*return;/s);
  assert.match(app, /selectedSession=id;\s*selectedPartition='';\s*setSessionListOpen\(id, true, details\);\s*page='workspace';\s*resetChat\(\);\s*resetGroup\(\);\s*watchSessionEvents\(id\);\s*loadGroupHistory\(api,id\)/s);
  assert.match(chatJs, /data-group-chat/);
  assert.match(chatJs, /export function groupPanel/);
  assert.match(css, /\.group-layout/);
  assert.match(css, /\.chat-content\{[^}]*display:\s*flex/);
  assert.match(app, /chat-content[\s\S]*extensionPane\(\)/);
  assert.match(app, /if\(!selectedPartition \|\| !a\)\{\s*return `<div class="chat-page">\$\{groupChatPanel\(s,p\)\}<\/div>`;/s);
  assert.match(app, /const talkingManager=isManagerPart\(a\);/);
  assert.doesNotMatch(app, /selectedPartition=managerPartOf/);
  assert.doesNotMatch(app, /talkingManager=!a\|\|isManagerPart/);
  assert.doesNotMatch(app, /loadChatHistory\(api,selectedSession,''\)/);
});

test('置顶、重命名、归档、移除项目，无名会话自动叫新会话', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-proj-'));
  try {
    await withServer({
      projects: [
        { id: 'p1', name: 'alpha', path: folder, sessions: [{ id: 's1', name: '旧会话', partitions: [] }] },
        { id: 'p2', name: 'beta', path: folder, sessions: [] },
      ],
      connections: [],
    }, async ({ address, post, dir }) => {
      const pinned = await (await post('/api/project/pin', { id: 'p2' })).json();
      assert.equal(pinned.projects.find(p => p.id === 'p2').pinned, true);
      const renamed = await (await post('/api/project/rename', { id: 'p1', name: '阿尔法' })).json();
      assert.equal(renamed.projects.find(p => p.id === 'p1').name, '阿尔法');
      const blank = await post('/api/project/rename', { id: 'p1', name: '  ' });
      assert.equal(blank.status, 400);
      const created = await (await post('/api/session', { projectId: 'p1' })).json();
      const names = created.projects.find(p => p.id === 'p1').sessions.map(s => s.name);
      assert.ok(names.includes('新会话'));
      const fresh = created.projects.find(p => p.id === 'p1').sessions.find(s => s.name === '新会话');
      assert.equal(fresh.partitions.length, 1);
      assert.equal(fresh.partitions[0].name, '管理者AI');
      assert.equal(fresh.partitions[0].role, 'manager');
      const again = await (await post('/api/session', { projectId: 'p1' })).json();
      assert.ok(again.projects.find(p => p.id === 'p1').sessions.some(s => s.name === '新会话 2'));
      const archived = await (await post('/api/project/archive', { id: 'p1', archived: true })).json();
      assert.ok(archived.projects.find(p => p.id === 'p1').sessions.every(s => s.archived));
      const restored = await (await post('/api/project/archive', { id: 'p1', archived: false })).json();
      assert.ok(restored.projects.find(p => p.id === 'p1').sessions.every(s => !s.archived));
      const missingReveal = await post('/api/project/reveal', { id: 'missing' });
      assert.equal(missingReveal.status, 400);
      const removed = await (await post('/api/project/remove', { id: 'p2' })).json();
      assert.deepEqual(removed.projects.map(p => p.id), ['p1']);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
      assert.equal(saved.projects.length, 1);
      assert.equal(saved.projects[0].name, '阿尔法');
      const migrated = await (await fetch(address + '/api/state')).json();
      const old = migrated.projects.find(p => p.id === 'p1').sessions.find(s => s.id === 's1');
      assert.ok(old.partitions.some(part => part.role === 'manager' && part.name === '管理者AI'));
    });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
