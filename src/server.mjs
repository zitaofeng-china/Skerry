import { validateModelGroups } from '../public/model-groups.js';
import { normalizeConnectionModelConfigs, REASONING_LEVELS } from '../public/model-selection.js';
import { isValidProtocol } from '../public/protocols.js';
import { statuses, authAction, refreshOfficialIfNeeded, officialAccessToken, officialTokenRecord } from './auth.mjs';
import { decodeModelResponse, extractModelPreview, fetchModelCatalog, fetchOfficialModels, hasModelReply, TEST_PROMPT, testOfficialModel, testApiEndpoints } from './model-fetch.mjs';
import { defaultFetchFor } from './official-client-http.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { saveSecret, loadSecret, hasSecret, deleteSecret } from './secret-store.mjs';
import { attachModel, selectManager, ensureManagerPartition, groupOfConnection, snapshotManagerSelection, managerPayloadForConnection } from './core.mjs';
import { applyRequestTimezone, applyResponseTimezone, ensureSessionTimezone, pickSessionTimezone } from './session-timezone.mjs';
import { handleAbort, handleChat, handleGroupHistory, handleHistory, handleHitl, handleMode, handleSessionEvents } from './agent/chat.mjs';
import { collectSessionArtifacts } from './agent/artifacts.mjs';
import { listWorkspaceDir, previewWorkspaceFile, fileKindIcon } from './agent/workspace-io.mjs';
import { dataDir, workspaceStatePath, workspaceRoot, ensureWorkspaceRoot, writeConfig, readConfig, publicDirSafe, defaultWorkspaceRoot } from './paths.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!process.env.AGENTS_DATA_DIR) process.env.AGENTS_DATA_DIR = dataDir();
const file = workspaceStatePath();
fs.mkdirSync(path.dirname(file), {recursive:true});
function loadState() {
  if (!fs.existsSync(file)) return {projects:[],connections:[]};
  try {
    const parsed = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {projects:[],connections:[]};
    return {projects: Array.isArray(parsed.projects)?parsed.projects:[], connections: Array.isArray(parsed.connections)?parsed.connections:[], ...parsed};
  } catch {
    return {projects:[],connections:[]};
  }
}
let state = loadState();
const persist = () => { fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2)); fs.renameSync(file+'.tmp',file); };
function migrateLegacyProtocols() {
  let changed = false;
  for (const c of state.connections || []) {
    if (c.protocol === 'gemini') {
      c.protocol = 'openai';
      changed = true;
    }
  }
  return changed;
}
if (migrateLegacyProtocols()) persist();
const run = promisify(execFile);
let port = Number(process.env.PORT || 4317);
let origin = `http://127.0.0.1:${port}`;
function layoutInfo() {
  const cfg = readConfig();
  return {
    dataDir: path.dirname(file),
    workspaceRoot: workspaceRoot(),
    defaultWorkspaceRoot: defaultWorkspaceRoot(),
    platform: process.platform,
  };
}

function clean() {
  const loggedOut=new Set(state.loggedOutOfficial||[]);
  const officialConfigs=state.officialModelConfigs||{};
  const official=statuses().map(c=>{
    const base=loggedOut.has(c.id)?{...c,connected:false,expired:false,email:null,credentialSource:null,authError:undefined}:c;
    return {...base,modelConfigs:officialConfigs[c.id]||{}};
  });
  const {loggedOutOfficial,officialModelConfigs,...rest}=state;
  return {...rest, activeProviders: state.activeProviders||{}, official, connections: state.connections.map(c=>({...c,hasKey:hasSecret(c.id)})), layout: layoutInfo()};
}

function revealFolder(folder) {
  if (process.platform === 'win32') return run('explorer.exe',[folder]);
  if (process.platform === 'darwin') return run('open',[folder]);
  return run('xdg-open',[folder]);
}

function pickFolder(startDir) {
  const start = startDir && fs.existsSync(startDir) ? startDir : ensureWorkspaceRoot();
  if (process.platform === 'darwin') {
    const script = `POSIX path of (choose folder with prompt "选择本地项目" default location POSIX file ${JSON.stringify(start)})`;
    return run('osascript',['-e', script]).then(({stdout})=>stdout.trim().replace(/\/$/, ''));
  }
  if (process.platform === 'win32') {
    const escaped = start.replace(/'/g, "''");
    return run('powershell.exe',['-NoProfile','-STA','-Command',`Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description="选择本地项目"; $dialog.SelectedPath='${escaped}'; if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath)}`],{windowsHide:true}).then(({stdout})=>stdout.trim());
  }
  return Promise.resolve('');
}
async function body(req) { let data=''; for await (const chunk of req) {data+=chunk; if(data.length>100000) throw new Error('请求过大');} return JSON.parse(data || '{}'); }
function validate(c) {
  if(!c.name?.trim()) throw new Error('请输入连接名称');
  const url = new URL(c.baseUrl);
  if(url.username || url.password || url.search || url.hash) throw new Error('API 地址不能含凭据、查询或片段');
  if(url.protocol !== 'https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('远程 API 请使用 HTTPS');
  if(!isValidProtocol(c.protocol)) throw new Error('请选择有效协议');
}
function optionalHttpsUrl(value, label, allowQuery) {
  const s=String(value||'').trim();
  if(!s) return '';
  let url;
  try { url=new URL(s); } catch { throw new Error(label+'无效'); }
  if(url.username||url.password) throw new Error(label+'不能含凭据');
  if(!allowQuery && (url.search||url.hash)) throw new Error(label+'不能含查询或片段');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error(label+'请使用 HTTPS');
  return s;
}
function stringList(value, max=20) {
  if(!Array.isArray(value)) return [];
  const out=[], seen=new Set();
  for(const item of value){
    const s=String(item||'').trim().replace(/\/+$/,'');
    if(!s||seen.has(s)||out.length>=max) continue;
    try { optionalHttpsUrl(s,'端点',false); } catch { continue; }
    seen.add(s); out.push(s);
  }
  return out;
}
function uniqueSessionName(project, base = '新会话') {
  const names = new Set((project.sessions || []).map(s => s.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function findProject(id) {
  const p = (state.projects || []).find(p => p.id === String(id || ''));
  if (!p) throw new Error('项目不存在');
  return p;
}
function uniqueCopyName(name) {
  const names = new Set((state.connections || []).map(c => c.name));
  const trimmed = String(name || '').trim();
  const base = `${trimmed} (copy)`;
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${trimmed} (copy ${n})`)) n++;
  return `${trimmed} (copy ${n})`;
}
function copyConnection(id) {
  if (String(id || '').startsWith('official-')) throw new Error('官方登录不可复制');
  const idx = state.connections.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('连接不存在');
  const source = state.connections[idx];
  const {id: _id, hasKey: _hasKey, ...rest} = JSON.parse(JSON.stringify(source));
  const clone = {...rest, id: crypto.randomUUID(), name: uniqueCopyName(source.name)};
  validate(clone);
  state.connections.splice(idx + 1, 0, clone);
  const key = loadSecret(source.id);
  if (key) saveSecret(clone.id, key);
  persist();
}
function extraFields(b, existing) {
  const pick=(key,max=200)=>b[key]!==undefined?String(b[key]||'').trim().slice(0,max):(existing?.[key]||'');
  const icon=pick('icon',64);
  if(icon && !/^[a-zA-Z0-9_-]+$/.test(icon)) throw new Error('图标无效');
  const iconColor=pick('iconColor',16);
  if(iconColor && !/^#?[0-9A-Fa-f]{3,8}$/.test(iconColor)) throw new Error('图标颜色无效');
  const iconFile=pick('iconFile',80);
  if(iconFile && !/^[a-zA-Z0-9._-]+$/.test(iconFile)) throw new Error('图标文件无效');
  return {
    notes:pick('notes',200),
    websiteUrl:b.websiteUrl!==undefined?optionalHttpsUrl(b.websiteUrl,'网站地址',true):(existing?.websiteUrl||''),
    icon, iconColor, iconFile,
    presetId:pick('presetId',80),
    apiKeyUrl:b.apiKeyUrl!==undefined?optionalHttpsUrl(b.apiKeyUrl,'密钥链接',true):(existing?.apiKeyUrl||''),
    modelsUrl:b.modelsUrl!==undefined?optionalHttpsUrl(b.modelsUrl,'模型列表地址',false):(existing?.modelsUrl||''),
    endpointCandidates:b.endpointCandidates!==undefined?stringList(b.endpointCandidates):(existing?.endpointCandidates||[]),
    customEndpoints:b.customEndpoints!==undefined?stringList(b.customEndpoints):(existing?.customEndpoints||[]),
    isPartner:b.isPartner!==undefined?Boolean(b.isPartner):Boolean(existing?.isPartner),
    primePartner:b.primePartner!==undefined?Boolean(b.primePartner):Boolean(existing?.primePartner),
    partnerPromotionKey:pick('partnerPromotionKey',64),
    category:pick('category',32),
  };
}
function findSession(sessionId) {
  const id = String(sessionId || '');
  if (!id) return null;
  return state.projects.flatMap(p => p.sessions || []).find(s => s.id === id) || null;
}
function findProjectForSession(sessionId) {
  const id = String(sessionId || '');
  if (!id) return null;
  return (state.projects || []).find(p => (p.sessions || []).some(s => s.id === id)) || null;
}
function ensureAllSessionTimezones() {
  let changed = false;
  for (const project of state.projects || []) {
    for (const session of project.sessions || []) {
      const before = session.timezone;
      ensureSessionTimezone(session);
      if (session.timezone !== before) changed = true;
    }
  }
  return changed;
}
function managerPool() {
  const c = clean();
  return [
    ...c.connections.map(x => ({ ...x, kind: x.kind || 'custom' })),
    ...c.official.map(x => ({ ...x, kind: 'official' })),
  ];
}
function rememberManagerSelection(group, manager) {
  const snap = snapshotManagerSelection(manager);
  if (!group || !snap) return;
  state.managerSelections = { ...(state.managerSelections || {}), [group]: snap };
}
function retargetManagerTo(group, connection) {
  if (!state.manager || !connection || !group) return;
  const pool = managerPool();
  const current = pool.find(c => c.id === state.manager.connectionId);
  if (groupOfConnection(current || { id: state.manager.connectionId }) !== group) return;
  const last = state.managerSelections?.[group] || snapshotManagerSelection(state.manager);
  try {
    state.manager = selectManager(pool, managerPayloadForConnection(connection, group, last));
    rememberManagerSelection(group, state.manager);
  } catch { /* 新提供商选不了时保持原管理者，激活本身仍成功 */ }
}
function ensureAllManagerPartitions() {
  let changed = false;
  for (const project of state.projects || []) {
    for (const session of project.sessions || []) {
      const before = JSON.stringify(session.partitions || []);
      ensureManagerPartition(session);
      if (JSON.stringify(session.partitions) !== before) changed = true;
    }
  }
  return changed;
}
function sessionTimezone(sessionId) {
  const session = findSession(sessionId);
  if (!session) return '';
  const before = session.timezone;
  const timezone = ensureSessionTimezone(session);
  if (session.timezone !== before) persist();
  return timezone;
}
async function remote(c, testModel, timezone, keyOverride, effort) {
  const key = keyOverride || (c.id ? loadSecret(c.id) : '');
  if(!key) throw new Error(c.id ? '请先保存 API Key' : '请填写 API Key');
  let url=c.baseUrl.replace(/\/+$/,''), headers={}, payload;
  const level = REASONING_LEVELS.includes(String(effort || '').trim().toLowerCase())
    ? String(effort).trim().toLowerCase()
    : '';
  if(c.protocol==='anthropic') {
    headers={'x-api-key':key,'anthropic-version':'2023-06-01'};
    url+=testModel?'/messages':'/models';
    if(testModel) payload={model:testModel,max_tokens:128,messages:[{role:'user',content:TEST_PROMPT}]};
  } else if(c.protocol==='responses') {
    headers={Authorization:`Bearer ${key}`};
    url+=testModel?'/responses':'/models';
    if(testModel) {
      payload={
        model:testModel,
        input:[{type:'message',role:'user',content:[{type:'input_text',text:TEST_PROMPT}]}],
        store:false,
        max_output_tokens:128,
      };
      if(level) payload.reasoning={effort:level};
    }
  } else {
    headers={Authorization:`Bearer ${key}`}; url+=testModel?'/chat/completions':'/models';
    if(testModel) payload={model:testModel,messages:[{role:'user',content:TEST_PROMPT}],max_tokens:128};
  }
  if (payload) payload = applyRequestTimezone(payload, timezone);
  const t0 = Date.now();
  const response=await fetch(url,{method:payload?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(25000),redirect:'error'});
  const durationMs = Date.now() - t0;
  const text=await response.text();
  if(!response.ok) throw new Error(`供应商返回 HTTP ${response.status}，请检查地址、密钥、模型权限及协议`);
  let data=decodeModelResponse(text);
  if(testModel) {
    data = applyResponseTimezone(data, timezone);
    if(!hasModelReply(data)) throw new Error('API 已响应，但未返回有效模型内容');
    const preview=extractModelPreview(data);
    return preview?{message:'模型请求成功', durationMs, preview}:{message:'模型请求成功', durationMs};
  }
  const models=(data.data || data.models || []).map(m=>m.id || m.name?.replace(/^models\//,'')).filter(m=>typeof m==='string');
  if(!models.length) throw new Error('接口未返回模型列表，可手动填写模型标识');
  return {models:[...new Set(models)], durationMs};
}
const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(req.headers.host!==`127.0.0.1:${port}`) return send(403,{error:'无效主机'});
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')) {
      if(req.method==='GET' && url.pathname==='/api/state') {
        await refreshOfficialIfNeeded();
        let migrated = ensureAllSessionTimezones();
        if (ensureAllManagerPartitions()) migrated = true;
        if (migrated) persist();
        return send(200,clean());
      }
      if(req.method==='GET' && url.pathname==='/api/session/events') {
        handleSessionEvents({
          dataDir:path.dirname(file),
          state,
        }, url.searchParams, req, res);
        return;
      }
      if(req.method!=='POST' || req.headers.origin!==origin || req.headers['content-type']!=='application/json') return send(403,{error:'无效请求来源'});
      const b=await body(req);
      if(url.pathname.startsWith('/api/auth/')) {
        const action=url.pathname.split('/').pop();
        const result=await authAction(action,b);
        const id=String(b.id||'');
        if(action==='disconnect' && id){
          state.loggedOutOfficial=[...new Set([...(state.loggedOutOfficial||[]),id])];
          if(state.manager?.connectionId===id) state.manager=null;
          if(state.activeProviders){
            for(const key of Object.keys(state.activeProviders)){
              if(state.activeProviders[key]===id) delete state.activeProviders[key];
            }
          }
          persist();
        }else if((action==='start'||action==='complete') && id && (state.loggedOutOfficial||[]).includes(id)){
          state.loggedOutOfficial=(state.loggedOutOfficial||[]).filter(item=>item!==id);
          persist();
        }
        return send(200,result);
      } else if(url.pathname==='/api/layout') {
        let next=String(b.workspaceRoot||'').trim();
        if(!next || !fs.existsSync(next) || !fs.statSync(next).isDirectory()){
          next=await pickFolder(next||defaultWorkspaceRoot());
        }
        if(!next) throw new Error('请选择工作区母目录');
        const resolved=path.resolve(next);
        fs.mkdirSync(resolved,{recursive:true});
        writeConfig({workspaceRoot:resolved});
      } else if(url.pathname==='/api/project') {
        const requested=String(b.path||'').trim();
        const start=requested?path.resolve(requested):workspaceRoot();
        const folder=requested && fs.existsSync(requested) && fs.statSync(requested).isDirectory()
          ? path.resolve(requested)
          : await pickFolder(start);
        if(folder){
          const resolved=fs.realpathSync(folder);
          const same=p=>process.platform==='win32'?p.path.toLowerCase()===resolved.toLowerCase():p.path===resolved;
          if(!state.projects.some(same))state.projects.push({id:crypto.randomUUID(),name:path.basename(resolved),path:resolved,sessions:[]});
          persist();
        }
      } else if(url.pathname==='/api/project/relocate') {
        const p=findProject(b.id);
        const next=String(b.path||'').trim();
        const folder=next && fs.existsSync(next) && fs.statSync(next).isDirectory()
          ? path.resolve(next)
          : await pickFolder(p.path||workspaceRoot());
        if(!folder) throw new Error('未选择新位置');
        p.path=fs.realpathSync(folder);
        persist();
      } else if(url.pathname==='/api/project/pin') {
        const p=findProject(b.id);
        p.pinned=!p.pinned;
        persist();
      } else if(url.pathname==='/api/project/rename') {
        const p=findProject(b.id);
        const name=String(b.name||'').trim().slice(0,100);
        if(!name) throw new Error('请输入项目名称');
        p.name=name;
        persist();
      } else if(url.pathname==='/api/project/reveal') {
        const p=findProject(b.id);
        const folder=p.path && fs.existsSync(p.path) ? fs.realpathSync(p.path) : '';
        if(!folder) throw new Error('项目文件夹不存在');
        await revealFolder(folder).catch(()=>{});
      } else if(url.pathname==='/api/project/archive') {
        const p=findProject(b.id);
        const archived=b.archived!==false && b.archived!==0 && b.archived!=='0';
        for(const s of p.sessions||[]) s.archived=Boolean(archived);
        persist();
      } else if(url.pathname==='/api/project/remove') {
        findProject(b.id);
        state.projects=state.projects.filter(p=>p.id!==String(b.id||''));
        persist();
      } else if(url.pathname==='/api/manager') {
        const pool=managerPool();
        state.manager=selectManager(pool,b);
        const conn=pool.find(c=>c.id===state.manager.connectionId);
        rememberManagerSelection(groupOfConnection(conn||{id:state.manager.connectionId}), state.manager);
        persist();
      } else if(url.pathname==='/api/session') {
        const p=state.projects.find(p=>p.id===b.projectId);if(!p)throw new Error('项目不存在');
        const requested=String(b.name||'').trim().slice(0,100);
        const session={id:crypto.randomUUID(),name:requested||uniqueSessionName(p),partitions:[],timezone:pickSessionTimezone()};
        ensureManagerPartition(session);
        p.sessions.push(session);persist();
      } else if(url.pathname==='/api/partition') {
        const s=state.projects.flatMap(p=>p.sessions).find(s=>s.id===b.sessionId);
        if(!s || ![...state.connections,...statuses().filter(c=>c.connected && !c.expired)].some(c=>c.id===b.connectionId))throw new Error('请选择会话与模型连接');
        if(!String(b.model||'').trim())throw new Error('请输入模型标识');
        attachModel(s,b.connectionId,b.model.trim(),b.canonical);persist();
      } else if(url.pathname==='/api/connection/delete') {
        if(String(b.id||'').startsWith('official-')) throw new Error('官方登录不可删除');
        const idx=state.connections.findIndex(c=>c.id===b.id);
        if(idx===-1) throw new Error('连接不存在');
        state.connections.splice(idx,1);
        deleteSecret(b.id);
        if(state.manager?.connectionId===b.id) state.manager=null;
        if(state.activeProviders){for(const k in state.activeProviders){if(state.activeProviders[k]===b.id)delete state.activeProviders[k];}}
        persist();
      } else if(url.pathname==='/api/connection/activate') {
        if(!b.group) throw new Error('缺少模型系列标识');
        const group=String(b.group);
        state.activeProviders=state.activeProviders||{};
        state.activeProviders[group]=b.id;
        const next=managerPool().find(c=>c.id===b.id);
        if(next) retargetManagerTo(group, next);
        persist();
      } else if(url.pathname==='/api/connection/copy') {
        copyConnection(b.id);
      } else if(url.pathname==='/api/connection') {
        const id=String(b.id||'');
        if(id.startsWith('official-')){
          if(!statuses().some(c=>c.id===id))throw new Error('官方连接不存在');
          const incoming=normalizeConnectionModelConfigs(b.modelConfigs||{});
          state.officialModelConfigs={...(state.officialModelConfigs||{}),[id]:{...(state.officialModelConfigs?.[id]||{}),...incoming}};
          persist();
        }else{
          const existing=state.connections.find(c=>c.id===b.id);
          const modelGroups=b.modelGroups!==undefined?validateModelGroups(b.modelGroups):existing?.modelGroups;
          const modelConfigs=normalizeConnectionModelConfigs(b.modelConfigs&&typeof b.modelConfigs==='object'?b.modelConfigs:(existing?.modelConfigs||{}),modelGroups);
          const extra=extraFields(b, existing);
          const c={id:existing?.id||crypto.randomUUID(),name:String(b.name||'').trim(),provider:String(b.provider||'自定义'),protocol:b.protocol,baseUrl:String(b.baseUrl||'').trim(),models:existing?.models||[],modelConfigs,...extra,...(modelGroups?{modelGroups}:{})};validate(c);
          if(b.key?.trim())saveSecret(c.id,b.key.trim());
          if(existing)Object.assign(existing,c);else state.connections.push(c);persist();
        }
      } else if(url.pathname==='/api/models') {
        const id=String(b.id||'');
        if(id.startsWith('official-')){
          await refreshOfficialIfNeeded(id);
          const official=statuses().find(c=>c.id===id);
          if(!official)throw new Error('官方连接不存在');
          if(!official.connected)throw new Error('请先登录官方账号后再拉取模型');
          if(official.expired||official.authError)throw new Error('授权已失效，请重新登录后再拉取模型');
          let accessToken;
          try{accessToken=await officialAccessToken(id);}
          catch(e){
            if(e?.name==='OAuthError'||['oauth_access_token_unavailable','oauth_refresh_failed','invalid_grant','invalid_token'].includes(e?.code)){
              throw new Error('授权已失效，请重新登录后再拉取模型');
            }
            throw e;
          }
          const stored=officialTokenRecord(id)||{};
          const catalog=await fetchOfficialModels(id,{
            accessToken,
            accountID:stored.accountID||stored.account_id,
            fetcher:defaultFetchFor(id),
          });
          if(!catalog.length)throw new Error('接口未返回模型列表，可手动填写模型标识');
          return send(200,{models:catalog.map(m=>m.id),catalog});
        }
        const existing=id?state.connections.find(c=>c.id===id):null;
        if(id && !existing)throw new Error('连接不存在');
        const key=String(b.key||'').trim() || (existing?loadSecret(existing.id):'');
        const draft={
          protocol:b.protocol||existing?.protocol,
          baseUrl:String(b.baseUrl||existing?.baseUrl||'').trim(),
          modelsUrl:String(b.modelsUrl||existing?.modelsUrl||'').trim(),
        };
        if(!draft.baseUrl)throw new Error('请输入 API 基础地址');
        if(!isValidProtocol(draft.protocol))throw new Error('请选择有效协议');
        const t0=Date.now();
        const catalog=await fetchModelCatalog(draft,key);
        const durationMs=Date.now()-t0;
        if(!catalog.length)throw new Error('接口未返回模型列表，可手动填写模型标识');
        return send(200,{models:catalog.map(m=>m.id),catalog,durationMs});
      } else if(url.pathname==='/api/test') {
        const id=String(b.id||'');
        if(!String(b.model||'').trim())throw new Error('请填写要测试的模型');
        if(id.startsWith('official-')){
          await refreshOfficialIfNeeded(id);
          const official=statuses().find(c=>c.id===id);
          if(!official)throw new Error('官方连接不存在');
          if(!official.connected)throw new Error('请先登录官方账号后再测试模型');
          if(official.expired||official.authError)throw new Error('授权已失效，请重新登录后再测试模型');
          let accessToken;
          try{accessToken=await officialAccessToken(id);}
          catch(e){
            if(e?.name==='OAuthError'||['oauth_access_token_unavailable','oauth_refresh_failed','invalid_grant','invalid_token'].includes(e?.code)){
              throw new Error('授权已失效，请重新登录后再测试模型');
            }
            throw e;
          }
          const stored=officialTokenRecord(id)||{};
          return send(200,await testOfficialModel(id,{
            accessToken,
            accountID:stored.accountID||stored.account_id,
            model:String(b.model).trim(),
            effort:b.effort,
            timezone:sessionTimezone(b.sessionId),
            fetcher:defaultFetchFor(id),
          }));
        }
        if(!id){
          const draft={name:'draft',protocol:b.protocol,baseUrl:String(b.baseUrl||'').trim()};
          validate(draft);
          if(!String(b.key||'').trim()) throw new Error('请填写 API Key');
          return send(200,await remote(draft,b.model,sessionTimezone(b.sessionId),b.key.trim(),b.effort));
        }
        const c=state.connections.find(c=>c.id===id);if(!c)throw new Error('连接不存在');
        return send(200,await remote(c,b.model,sessionTimezone(b.sessionId),undefined,b.effort));
      } else if(url.pathname==='/api/endpoints/test') {
        return send(200,{results:await testApiEndpoints(b.urls,b.timeoutSecs)});
      } else if(url.pathname==='/api/chat') {
        await handleChat({
          dataDir:path.dirname(file),
          state,
          statuses,
          hasSecret,
          officialAccessToken,
          officialTokenRecord,
          loadSecret,
          refreshOfficialIfNeeded,
          persist,
        },b,req,res);
        return;
      } else if(url.pathname==='/api/chat/hitl') {
        return send(200,handleHitl(b));
      } else if(url.pathname==='/api/chat/history') {
        return send(200,handleHistory({dataDir:path.dirname(file),state},b));
      } else if(url.pathname==='/api/group/history') {
        return send(200,handleGroupHistory({dataDir:path.dirname(file),state},b));
      } else if(url.pathname==='/api/chat/mode') {
        return send(200,handleMode({dataDir:path.dirname(file),state},b));
      } else if(url.pathname==='/api/chat/abort') {
        return send(200,handleAbort({dataDir:path.dirname(file),state},b));
      } else if(url.pathname==='/api/session/rename') {
        const s=findSession(b.id);
        if(!s) throw new Error('会话不存在');
        const name=String(b.name||'').trim().slice(0,100);
        if(!name) throw new Error('请输入会话名称');
        s.name=name;
        persist();
      } else if(url.pathname==='/api/session/artifacts') {
        const s=findSession(b.sessionId);
        if(!s) throw new Error('会话不存在');
        return send(200,collectSessionArtifacts(path.dirname(file), s.id));
      } else if(url.pathname==='/api/workspace/file') {
        const project=findProjectForSession(b.sessionId);
        if(!project) throw new Error('会话不存在');
        const preview=previewWorkspaceFile(project.path, b.path);
        if(!preview.ok && !preview.kind) throw new Error(preview.error || '无法打开文件');
        return send(200,preview);
      } else if(url.pathname==='/api/workspace/list') {
        const project=findProjectForSession(b.sessionId);
        if(!project) throw new Error('会话不存在');
        const listed=listWorkspaceDir(project.path, b.path || '.');
        if(!listed.ok) throw new Error(listed.error || '无法列出目录');
        const slash=value=>(value||'').replace(/\\/g,'/');
        const relative=slash(path.relative(project.path, listed.path) || '.') || '.';
        const atRoot=!relative || relative === '.';
        return send(200,{
          ok:true,
          path:listed.path,
          relative,
          parent: atRoot ? '' : (slash(path.dirname(relative)) || '.'),
          entries:(listed.entries||[]).map(entry=>{
            const full=path.join(listed.path, entry.name);
            return {
              ...entry,
              path:full,
              relative:slash(path.relative(project.path, full) || entry.name),
              kind: entry.type==='directory' ? 'directory' : fileKindIcon(entry.name),
            };
          }),
        });
      } else return send(404,{error:'接口不存在'});
      return send(200,clean());
    }
    const localFile = publicDirSafe(root, url.pathname);
    if (!localFile || !fs.existsSync(localFile) || fs.statSync(localFile).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    const ext = path.extname(localFile);
    const mime = {'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext] || 'text/html; charset=utf-8';
    res.writeHead(200, {'Content-Type':mime,'Content-Security-Policy':"default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-store'});
    res.end(fs.readFileSync(localFile));
  } catch(e){send(400,{error:e.name==='TimeoutError'?'连接超时，请检查网络和 API 地址':e.message==='fetch failed'?'无法连接供应商，请检查网络和 API 地址':e.message});}
});
server.listen(port,'127.0.0.1',()=>{port=server.address().port;origin=`http://127.0.0.1:${port}`;console.log(`AGENTS_READY ${origin}`);});
if(process.env.AGENTS_DESKTOP==='1'){process.stdin.resume();process.stdin.on('end',()=>process.exit(0));}






