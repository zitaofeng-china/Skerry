import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {saveSecret,deleteSecret} from './secret-store.mjs';
import {footer,managerForm,managerCards,settingsShell,accountSwitcher,appSwitcher,parseSettingsTab,SETTINGS_TABS,SETTINGS_NAV,activeProviderForGroup,managerSeriesId,managerActorLabel} from '../public/shell.js';
import {MODEL_GROUPS} from '../public/model-groups.js';
import {renderOfficialCard, renderProviderCard} from '../public/provider-card.js';
const initial={projects:[],connections:[],official:[]};
test('独立设置页面没有项目侧栏，左侧路由栏含模型选择和快捷键',()=>{
 const html=settingsShell('<h1>模型选择</h1>');
 assert.match(html,/返回工作台/);assert.match(html,/关闭设置/);
 assert.match(html,/>模型选择</);assert.match(html,/>快捷键</);
 assert.match(html,/data-action="settings-section"/);
 assert.match(html,/data-id="models"[^>]*aria-current="page"/);
 assert.doesNotMatch(html,/data-id="shortcuts"[^>]*aria-current="page"/);
 assert.doesNotMatch(html,/模型与连接/);
 assert.doesNotMatch(html,/project-tree|sidebar-footer/);
 const shortcuts=settingsShell('<h1>快捷键</h1>','shortcuts');
 assert.match(shortcuts,/data-id="shortcuts"[^>]*aria-current="page"/);
 assert.doesNotMatch(shortcuts,/data-id="models"[^>]*aria-current="page"/);
});
test('设置页胶囊 Tabs 替换搜索，模型系列仍为 Claude Codex Gemini Grok',()=>{
 assert.deepEqual(MODEL_GROUPS.map(g=>g.name),['Claude','Codex','Gemini','Grok']);
 assert.deepEqual(SETTINGS_TABS.map(t=>t.label),['模型提供商','管理者 AI']);
 assert.deepEqual(SETTINGS_NAV.map(t=>t.label),['模型选择','快捷键']);
 assert.equal(parseSettingsTab('#settings/manager'),'manager');
 assert.equal(parseSettingsTab('#settings/providers'),'providers');
 assert.equal(parseSettingsTab('#settings/shortcuts'),'shortcuts');
 assert.equal(parseSettingsTab('#settings/custom'),'providers');
 assert.equal(parseSettingsTab('#settings/official'),'providers');
 assert.equal(parseSettingsTab('#settings/connections'),'providers');
 assert.equal(parseSettingsTab('#settings'),'providers');
 const pills=accountSwitcher('providers');
 assert.match(pills,/cc-pill-tabs/);assert.match(pills,/模型提供商/);assert.match(pills,/管理者 AI/);
 assert.doesNotMatch(pills,/官方账户/);
 assert.doesNotMatch(pills,/快捷键/);
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/function shortcutsPage/);
 assert.match(app,/打开 \/ 隐藏终端/);
 assert.match(app,/settingsTab==='shortcuts'/);
 assert.ok(app.indexOf('${pills}')<app.indexOf('${tabRow}'));
 assert.match(app,/cc-tab-row[\s\S]*cc-add-btn/);
 assert.doesNotMatch(app,/cc-section-title/);
 assert.doesNotMatch(app,/cc-provider-section/);
 assert.doesNotMatch(app,/该系列暂无官方登录/);
 assert.doesNotMatch(app,/还没有该系列的自定义提供商/);
 assert.match(app,/cc-provider-list/);
 assert.doesNotMatch(app,/cc-search-input|data-search-input|搜索 /);
 const switcher=appSwitcher('claude', MODEL_GROUPS);
 assert.match(switcher,/\/icons\/claude\.svg/);
 assert.match(switcher,/\/icons\/openai\.svg/);
 assert.match(switcher,/\/icons\/gemini\.svg/);
 assert.match(switcher,/\/icons\/grok\.svg/);
 assert.doesNotMatch(app,/切换模型系列/);
 assert.doesNotMatch(app,/set-manager/);
 assert.match(app,/managerCards\(state\)/);
 assert.doesNotMatch(app,/managerForm\(state, activeModelGroup\)/);
 assert.match(app,/connectionModelChoices/);
 assert.match(app,/preferredConnectionModel/);
 assert.match(app,/pick-manager/);
 assert.match(app,/refreshManagerView/);
 assert.match(app,/manager-card-fields/);
 assert.match(app,/managerActorLabel/);
 assert.match(app,/connection\/activate/);
});
test('已授权官方账号显示退出登录，不展示占位说明',()=>{
 const logged=renderOfficialCard({id:'official-codex',name:'Codex',connected:true,expired:false,loginAvailable:true},'codex',true);
 assert.match(logged,/退出登录/);
 assert.match(logged,/data-action="disconnect"/);
 assert.match(logged,/当前使用/);
 assert.match(logged,/aria-label="配置模型"/);
 assert.match(logged,/data-action="edit-provider"/);
 assert.match(logged,/data-action="test-provider"/);
 assert.match(logged,/aria-label="向模型发送 hi 并读取返回"/);
 assert.match(logged,/>Codex</);
 assert.doesNotMatch(logged,/Codex 官方登录/);
 assert.doesNotMatch(logged,/自定义提供商/);
 assert.doesNotMatch(logged,/官方认证/);
 assert.doesNotMatch(logged,/通过官方账号登录连接当前模型服务/);
 const anon=renderOfficialCard({id:'official-codex',name:'Codex',connected:false,loginAvailable:true,authLabel:'OpenAI 账号',description:'浏览器完成 OpenAI 授权后，工作台保存凭证。'},'codex',false);
 assert.doesNotMatch(anon,/退出登录/);
 assert.doesNotMatch(anon,/通过官方账号登录连接当前模型服务/);
 assert.doesNotMatch(anon,/CLI|无需安装/);
 assert.doesNotMatch(anon,/data-action="test-provider"/);
 assert.doesNotMatch(anon,/OpenAI 账号/);
 assert.doesNotMatch(anon,/官方认证/);
 assert.match(anon,/登录账号/);
 assert.match(anon,/aria-label="配置模型"/);
 assert.match(anon,/浏览器完成 OpenAI 授权后，工作台保存凭证。/);
});
test('官方授权作废时卡片展示授权已失效并提供重新登录',()=>{
 const html=renderOfficialCard({
  id:'official-gemini',
  name:'Gemini',
  connected:true,
  expired:true,
  loginAvailable:true,
  email:'keep@example.com',
  authError:{code:'invalid_grant',message:'授权已失效，请重新登录。'},
 },'gemini',false);
 assert.match(html,/授权已失效/);
 assert.match(html,/keep@example.com/);
 assert.match(html,/请重新登录/);
 assert.match(html,/登录账号/);
 assert.match(html,/退出登录/);
 assert.doesNotMatch(html,/已授权登录/);
 assert.doesNotMatch(html,/cc-switch-btn/);
 const escaped=renderOfficialCard({
  id:'official-grok',
  name:'Grok',
  connected:true,
  expired:true,
  loginAvailable:true,
  authError:{code:'invalid_grant',message:'<script>alert(1)</script>'},
 },'grok',false);
 assert.match(escaped,/&lt;script&gt;/);
 assert.doesNotMatch(escaped,/<script>alert\(1\)<\/script>/);
});
test('底部模型选择为空时提供连接入口，已选连接保持转义',()=>{
 const empty=footer(initial);assert.match(empty,/popover="auto"/);assert.match(empty,/前往模型提供商/);assert.match(empty,/aria-label="设置"/);
 const state={...initial,connections:[{id:'a',name:'<fake>',hasKey:true,models:['model-a']}],manager:{connectionId:'a',model:'model-a'}};
 const html=managerForm(state);assert.match(html,/&lt;fake&gt;/);assert.match(html,/value="a" checked/);assert.match(html,/value="model-a"/);assert.doesNotMatch(html,/<fake>/);
});
test('管理者模型来自官方已配置目录，不依赖空的 models[]',()=>{
 const official=[{id:'official-gemini',name:'Gemini',kind:'official',connected:true,expired:false,models:[],modelConfigs:{gemini:{defaultModel:'gemini-3.8-flash',catalog:[{model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash'},{model:'gemini-3.1-pro',displayName:'Gemini 3.1 Pro'}]}}}];
 const html=managerForm({projects:[],connections:[],official,manager:null},'gemini');
 assert.match(html,/official-gemini/);
 assert.match(html,/gemini-3.8-flash/);
 assert.match(html,/Gemini 3.8 Flash/);
 assert.match(html,/list="manager-models"/);
 assert.match(html,/data-action="save-manager"/);
 const claude=managerForm({projects:[],connections:[],official,manager:null},'claude');
 assert.match(claude,/先连接 Claude/);
});
test('管理者设置页按卡片展示全部系列，点卡片切换并包含型号努力程度上下文',()=>{
 const official=[
  {id:'official-claude',name:'Claude',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-codex',name:'Codex',kind:'official',connected:true,expired:false,email:'c@example.com',modelConfigs:{codex:{defaultModel:'gpt-5.6-luna',defaultEffort:'medium',contextWindow:272000,catalog:[{model:'gpt-5.6-luna',displayName:'GPT-5.6 Luna',contextWindow:272000,reasoningLevels:['low','medium','high']}]}}},
  {id:'official-gemini',name:'Gemini',kind:'official',connected:true,expired:false,modelConfigs:{gemini:{defaultModel:'gemini-3.8-flash',defaultEffort:'high',catalog:[{model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash',reasoningLevels:['low','medium','high'],effortModels:{high:'gemini-3.8-flash-high'}}]}}},
  {id:'official-grok',name:'Grok',kind:'official',connected:true,expired:false,email:'g@example.com',modelConfigs:{grok:{defaultModel:'grok-4.6',defaultEffort:'xhigh',contextWindow:131072,catalog:[{model:'grok-4.6',displayName:'Grok 4.6',contextWindow:131072,reasoningLevels:['low','high','xhigh']}]}}},
 ];
 const html=managerCards({projects:[],connections:[],official,manager:{connectionId:'official-grok',model:'grok-4.6',effort:'xhigh',contextWindow:131072}});
 assert.match(html,/data-manager-card/);
 assert.match(html,/data-action="pick-manager"/);
 assert.match(html,/型号/);
 assert.match(html,/努力程度/);
 assert.match(html,/上下文大小/);
 assert.match(html,/is-manager/);
 assert.match(html,/当前管理者/);
 assert.match(html,/official-grok/);
 assert.match(html,/official-codex/);
 assert.match(html,/official-gemini/);
 assert.match(html,/>Claude</);
 assert.match(html,/>Codex</);
 assert.match(html,/>Gemini</);
 assert.match(html,/>Grok</);
 assert.match(html,/未就绪/);
 assert.match(html,/尚未连接，请先在模型提供商中完成配置/);
 assert.match(html,/name="managerEffort"/);
 assert.match(html,/name="managerContext"/);
 assert.match(html,/value="131072"/);
 assert.match(html,/value="xhigh" selected/);
 assert.doesNotMatch(html,/cc-app-switcher/);
 assert.doesNotMatch(html,/使用此模型/);
 assert.doesNotMatch(html,/managerConnectionId/);
 assert.doesNotMatch(html,/官方登录/);
 assert.doesNotMatch(html,/自定义提供商/);
 assert.doesNotMatch(html,/c@example.com/);
 assert.doesNotMatch(html,/g@example.com/);
 assert.doesNotMatch(html,/cc-card-meta/);
});
test('每个模型系列只启用一个提供商，管理者跟当前启用的走',()=>{
 const official=[{id:'official-gemini',name:'Gemini',kind:'official',connected:true,expired:false,models:[],modelConfigs:{gemini:{defaultModel:'gemini-3.8-flash',catalog:[{model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash'}]}}}];
 const connections=[{id:'c1',name:'中转 Gemini',hasKey:true,modelGroups:['gemini'],modelConfigs:{gemini:{defaultModel:'gemini-flash',catalog:[{model:'gemini-flash',displayName:'Flash 中转'}]}}}];
 const fallback=activeProviderForGroup({official,connections},'gemini');
 assert.equal(fallback.id,'official-gemini');
 const picked=activeProviderForGroup({official,connections,activeProviders:{gemini:'c1'}},'gemini');
 assert.equal(picked.id,'c1');
 const html=managerForm({projects:[],connections,official,activeProviders:{gemini:'c1'},manager:null},'gemini');
 assert.match(html,/c1/);
 assert.match(html,/gemini-flash/);
 assert.doesNotMatch(html,/official-gemini/);
 const custom=renderProviderCard(connections[0],'gemini',true);
 assert.match(custom,/中转 Gemini/);
 assert.match(custom,/当前使用/);
 assert.doesNotMatch(custom,/自定义提供商/);
 assert.doesNotMatch(custom,/官方登录/);
 assert.doesNotMatch(custom,/set-manager/);
});
test('官方登录和自定义提供商同系列不分家，管理者只出一张卡',()=>{
 const official=[
  {id:'official-claude',name:'Claude',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-codex',name:'Codex',kind:'official',connected:true,expired:false,modelConfigs:{codex:{defaultModel:'gpt-5.6-terra',defaultEffort:'medium',contextWindow:128000,catalog:[{model:'gpt-5.6-terra',displayName:'gpt-5.6-terra'}]}}},
  {id:'official-gemini',name:'Gemini',kind:'official',connected:true,expired:false,modelConfigs:{gemini:{defaultModel:'gemini-3.8-flash',catalog:[{model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash'}]}}},
  {id:'official-grok',name:'Grok',kind:'official',connected:true,expired:false,modelConfigs:{grok:{defaultModel:'grok-4.6',catalog:[{model:'grok-4.6',displayName:'Grok 4.6'}]}}},
 ];
 const connections=[{id:'custom-codex',name:'Codex测试1',hasKey:true,modelGroups:['codex'],modelConfigs:{codex:{defaultModel:'GPT-5.6-Terra',defaultEffort:'medium',contextWindow:272000,catalog:[{model:'GPT-5.6-Terra',displayName:'GPT-5.6-Terra'}]}}}];
 const html=managerCards({projects:[],connections,official,manager:{connectionId:'official-grok',model:'grok-4.6'}});
 assert.equal([...html.matchAll(/class="cc-card-title">Codex</g)].length,1);
 assert.equal([...html.matchAll(/cc-provider-card manager-card/g)].length,4);
 assert.match(html,/official-codex/);
 assert.doesNotMatch(html,/custom-codex/);
 assert.doesNotMatch(html,/Codex测试1/);
 const switched=managerCards({projects:[],connections,official,activeProviders:{codex:'custom-codex'},manager:{connectionId:'custom-codex',model:'GPT-5.6-Terra'}});
 assert.equal([...switched.matchAll(/class="cc-card-title">Codex</g)].length,1);
 assert.match(switched,/custom-codex/);
 assert.match(switched,/GPT-5\.6-Terra/);
 assert.doesNotMatch(switched,/official-codex/);
 const form=managerForm({projects:[],connections,official,manager:{connectionId:'official-grok',model:'grok-4.6'}});
 assert.doesNotMatch(form,/custom-codex/);
 assert.equal([...form.matchAll(/<strong>Codex<\/strong>/g)].length,1);
});
test('当前管理者按系列标记，卡片跟当前启用提供商走',()=>{
 const official=[
  {id:'official-claude',name:'Claude',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-codex',name:'Codex',kind:'official',connected:true,expired:false,modelConfigs:{codex:{defaultModel:'gpt-5.6-terra',catalog:[{model:'gpt-5.6-terra'}]}}},
  {id:'official-gemini',name:'Gemini',kind:'official',connected:true,expired:false,modelConfigs:{gemini:{defaultModel:'gemini-3.8-flash',catalog:[{model:'gemini-3.8-flash'}]}}},
  {id:'official-grok',name:'Grok',kind:'official',connected:true,expired:false,modelConfigs:{grok:{defaultModel:'grok-4.6',defaultEffort:'xhigh',contextWindow:131072,catalog:[{model:'grok-4.6',displayName:'Grok 4.6',contextWindow:131072,reasoningLevels:['low','high','xhigh']}]}}},
 ];
 const connections=[{id:'custom-grok',name:'Grok-测试',hasKey:true,modelGroups:['grok'],modelConfigs:{grok:{defaultModel:'grok-4.6',defaultEffort:'medium',contextWindow:200000,catalog:[{model:'grok-4.6',displayName:'Grok 4.6',contextWindow:200000,reasoningLevels:['low','medium','high','xhigh']}]}}}];
 const state={projects:[],connections,official,activeProviders:{grok:'custom-grok'},manager:{connectionId:'official-grok',model:'grok-4.6',effort:'xhigh',contextWindow:131072}};
 assert.equal(managerSeriesId(state),'grok');
 assert.equal(managerActorLabel(state),'Grok · grok-4.6 · 极高');
 const html=managerCards(state);
 assert.equal([...html.matchAll(/is-manager/g)].length,1);
 assert.match(html,/manager-card is-manager"[^>]*data-id="custom-grok"[^>]*data-group="grok"/);
 assert.match(html,/data-id="custom-grok"[^>]*data-group="grok"/);
 assert.doesNotMatch(html,/data-id="official-grok"/);
 const grokCard=html.split('data-group="grok"')[1]?.split('</article>')[0]||'';
 assert.match(grokCard,/当前管理者/);
 const foot=footer(state);
 assert.match(foot,/Grok · grok-4\.6 · 极高/);
});
test('切走系列后卡片记住上次型号努力程度和上下文',()=>{
 const official=[
  {id:'official-claude',name:'Claude',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-codex',name:'Codex',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-gemini',name:'Gemini',kind:'official',connected:false,expired:false,models:[]},
  {id:'official-grok',name:'Grok',kind:'official',connected:true,expired:false,modelConfigs:{grok:{defaultModel:'grok-4.6',defaultEffort:'xhigh',contextWindow:131072,catalog:[{model:'grok-4.6',displayName:'Grok 4.6',contextWindow:131072,reasoningLevels:['high','xhigh']}]}}},
 ];
 const connections=[{id:'kiro',name:'kiro',hasKey:true,modelGroups:['claude'],modelConfigs:{claude:{env:{ANTHROPIC_MODEL:'claude-sonnet-5',ANTHROPIC_DEFAULT_OPUS_MODEL:'claude-opus-4'},defaultEffort:'medium',contextWindow:200000}}}];
 const html=managerCards({
  projects:[],
  connections,
  official,
  manager:{connectionId:'official-grok',model:'grok-4.6',effort:'xhigh',contextWindow:131072},
  managerSelections:{
   grok:{model:'grok-4.6',effort:'xhigh',contextWindow:131072},
   claude:{model:'claude-opus-4',effort:'high',contextWindow:64000},
  },
 });
 const claudeCard=html.split('data-group="claude"')[1]?.split('</article>')[0]||'';
 assert.match(claudeCard,/claude-opus-4/);
 assert.match(claudeCard,/value="high" selected/);
 assert.match(claudeCard,/value="64000"/);
 assert.doesNotMatch(claudeCard,/当前管理者/);
 const grokCard=html.split('data-group="grok"')[1]?.split('</article>')[0]||'';
 assert.match(grokCard,/当前管理者/);
 assert.match(grokCard,/value="131072"/);
});
test('管理者接口持久化并在服务重启后恢复，不改动会话',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agents-manager-'));
 const env={...process.env,PORT:'0',AGENTS_DESKTOP:'1',AGENTS_DATA_DIR:dir,MULTI_AGENT_SECRETS:path.join(dir,'secrets')};
 const seed={projects:[{id:'p',sessions:[{id:'s',partitions:[]}]}],connections:[{id:'a',name:'Test',baseUrl:'https://example.com/v1',protocol:'openai',models:['model-a']}]};
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(seed));saveSecret('a','synthetic-test-only',env);
 let child;
 async function start(){
  child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['pipe','pipe','pipe']});
  const [data]=await once(child.stdout,'data');return data.toString().trim().replace('AGENTS_READY ','');
 }
 async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.stdin.end();await done;}}
 try{
  let address=await start();
  const post=async body=>fetch(address+'/api/manager',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({connectionId:'missing',model:'model-a'})).status,400);
  const result=await post({connectionId:'a',model:'model-a'});assert.equal(result.status,200);
  const value=await result.json();assert.deepEqual(value.manager,{connectionId:'a',model:'model-a'});assert.deepEqual(value.projects,seed.projects);assert.equal(JSON.stringify(value).includes('synthetic-test-only'),false);
  const tuned=await post({connectionId:'a',model:'model-a',effort:'high',contextWindow:128000});assert.equal(tuned.status,200);assert.deepEqual((await tuned.json()).manager,{connectionId:'a',model:'model-a',effort:'high',contextWindow:128000});
  const grouped=await fetch(address+'/api/connection',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify({...seed.connections[0],modelGroups:['codex','claude']})});assert.equal(grouped.status,200);const groupedState=await grouped.json();assert.equal(groupedState.connections[0].hasKey,true);assert.deepEqual(groupedState.manager,{connectionId:'a',model:'model-a',effort:'high',contextWindow:128000});
  const invalid=await fetch(address+'/api/connection',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify({...seed.connections[0],modelGroups:['invalid']})});assert.equal(invalid.status,400);
  await stop();address=await start();
  const reloaded=await (await fetch(address+'/api/state')).json();assert.deepEqual(reloaded.manager,{connectionId:'a',model:'model-a',effort:'high',contextWindow:128000});
  assert.equal((await fetch(address+'/shell.js')).status,200);assert.deepEqual(reloaded.connections[0].modelGroups,['codex','claude']);assert.equal(reloaded.connections[0].hasKey,true);assert.equal((await fetch(address+'/model-groups.js')).status,200);
 }finally{await stop();deleteSecret('a',env);fs.rmSync(dir,{recursive:true,force:true});}
});
test('启用同系列提供商时管理者跟过去，不改会话',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agents-manager-act-'));
 const env={...process.env,PORT:'0',AGENTS_DESKTOP:'1',AGENTS_DATA_DIR:dir,MULTI_AGENT_SECRETS:path.join(dir,'secrets')};
 const partitions=[{id:'m',name:'管理者AI',role:'manager',routes:[]}];
 const seed={
  projects:[{id:'p',sessions:[{id:'s',name:'111',partitions}]}],
  connections:[
   {id:'g1',name:'Grok A',baseUrl:'https://example.com/v1',protocol:'openai',modelGroups:['grok'],modelConfigs:{grok:{defaultModel:'grok-4.6',catalog:[{model:'grok-4.6',contextWindow:200000,reasoningLevels:['low','medium','high','xhigh']}]}}},
   {id:'g2',name:'Grok B',baseUrl:'https://example.org/v1',protocol:'openai',modelGroups:['grok'],modelConfigs:{grok:{defaultModel:'grok-4.5',catalog:[{model:'grok-4.6',contextWindow:200000,reasoningLevels:['low','medium','high','xhigh']},{model:'grok-4.5',contextWindow:128000,reasoningLevels:['low','medium','high']}]}}},
   {id:'c1',name:'Claude A',baseUrl:'https://example.net/v1',protocol:'anthropic',modelGroups:['claude'],modelConfigs:{claude:{env:{ANTHROPIC_MODEL:'claude-sonnet-5'},defaultEffort:'medium',contextWindow:200000}}},
  ],
  manager:{connectionId:'g1',model:'grok-4.6',effort:'high',contextWindow:128000},
  activeProviders:{grok:'g1'},
 };
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(seed));
 saveSecret('g1','synthetic-g1',env);saveSecret('g2','synthetic-g2',env);saveSecret('c1','synthetic-c1',env);
 let child;
 async function start(){
  child=spawn(process.execPath,['src/server.mjs'],{env,stdio:['pipe','pipe','pipe']});
  const [data]=await once(child.stdout,'data');return data.toString().trim().replace('AGENTS_READY ','');
 }
 async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.stdin.end();await done;}}
 try{
  const address=await start();
  const post=async(path,body)=>fetch(address+path,{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const switched=await post('/api/manager',{connectionId:'c1',model:'claude-sonnet-5',effort:'medium',contextWindow:200000});
  assert.equal(switched.status,200);
  const afterClaude=await switched.json();
  assert.equal(afterClaude.manager.connectionId,'c1');
  assert.deepEqual(afterClaude.managerSelections.claude,{model:'claude-sonnet-5',effort:'medium',contextWindow:200000});
  assert.deepEqual(afterClaude.projects[0].sessions[0].partitions,partitions);
  const back=await post('/api/manager',{connectionId:'g1',model:'grok-4.6',effort:'high',contextWindow:128000});
  assert.equal(back.status,200);
  const activated=await post('/api/connection/activate',{id:'g2',group:'grok'});
  assert.equal(activated.status,200);
  const value=await activated.json();
  assert.equal(value.activeProviders.grok,'g2');
  assert.equal(value.manager.connectionId,'g2');
  assert.equal(value.manager.model,'grok-4.6');
  assert.equal(value.manager.effort,'high');
  assert.equal(value.manager.contextWindow,128000);
  assert.deepEqual(value.managerSelections.grok,{model:'grok-4.6',effort:'high',contextWindow:128000});
  assert.deepEqual(value.projects[0].sessions[0].partitions,partitions);
  const other=await post('/api/connection/activate',{id:'c1',group:'claude'});
  assert.equal(other.status,200);
  const kept=await other.json();
  assert.equal(kept.manager.connectionId,'g2');
  assert.equal(kept.activeProviders.claude,'c1');
 }finally{await stop();deleteSecret('g1',env);deleteSecret('g2',env);deleteSecret('c1',env);fs.rmSync(dir,{recursive:true,force:true});}
});
