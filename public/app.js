import {MODEL_GROUPS, connectionsInGroup, connectionGroups} from './model-groups.js';
import {resolveRequestModel, stripClaudeOneMMarker, connectionModelChoices, preferredConnectionModel, REASONING_LEVELS, REASONING_LABELS, managerSelectionView} from './model-selection.js';
import {icons, footer, managerForm, managerCards, settingsShell, appSwitcher, accountSwitcher, parseSettingsTab, esc, activeProviderForGroup, managerActorLabel, managerSeriesId} from './shell.js';
import {fileKind} from './file-icons.js';
import {renderProviderCard, renderOfficialCard, renderEmptyState} from './provider-card.js';
import {openProviderModal} from './provider-modal.js';
import {abortChat, applySessionEvent, chat, chatPanel, chatTerminalLog, chatToolCards, fitCompose, group, groupPanel, liveTasks, loadChatHistory, loadGroupHistory, patchCompose, renderLiveBoard, renderTaskBox, resetChat, resetGroup, resolveHitl, scrollChatToLatest, sendChat, setChatMode, toolFilePath} from './chat.js';
import {notice} from './toast.js';

let state={projects:[],connections:[],official:[],activeProviders:{}}, page=location.hash.startsWith('#settings')?'settings':'workspace', selectedSession='', selectedPartition='', open=new Set();
let activeModelGroup='claude';
let settingsTab=parseSettingsTab(location.hash);
let lastModelTab=settingsTab==='shortcuts'?'providers':settingsTab;
let extensionOpen=true;
let extensionTab='partitions';
let terminalOpen=false;
let projectMenu='';
let sessionMenu=false;
let workspaceTab='conversation';
let openFiles=[];
const filePreviews=new Map();
let summaryOpen=false;
let summaryAll=false;
let summaryData={outputs:[],sources:[]};
let filePickerOpen=false;
let filePickerDir='.';
let filePickerEntries=[];
let filePickerParent='';
const speedResults=new Map();
let sessionEvents=null;
let sessionEventsId='';
let partitionsDirty=false;

const $=s=>document.querySelector(s);
async function api(path,data){const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;}
async function refresh(){
 state=await api('state');
 if(selectedSession){
  const proj=state.projects.find(p=>(p.sessions||[]).some(s=>s.id===selectedSession));
  if(proj) open.add(proj.id);
 }
 render();
}
function allConnections(){return [...state.official.filter(c=>c.connected&&!c.expired),...state.connections];}
function session(){return state.projects.flatMap(p=>p.sessions).find(s=>s.id===selectedSession);}
function isManagerPart(p){return Boolean(p)&&(p.role==='manager'||(p.key==='manager'&&p.name==='管理者AI'));}
function isClonePart(p){return p?.role==='clone';}
function listedParts(s){return (s?.partitions||[]).filter(p=>!isClonePart(p));}
function managerPartId(s=session()){return (s?.partitions||[]).find(isManagerPart)?.id||'';}
function workerChatId(s=session(), id=selectedPartition){
 const part=(s?.partitions||[]).find(p=>p.id===id);
 return part && !isManagerPart(part) && !isClonePart(part) ? id : '';
}
function watchSessionEvents(id){
 if(sessionEventsId===id && sessionEvents) return;
 sessionEvents?.close();
 sessionEvents=null;
 sessionEventsId=id||'';
 if(!id) return;
 sessionEvents=new EventSource('/api/session/events?sessionId='+encodeURIComponent(id));
 const on=type=>e=>{
  let data={};
  try{data=JSON.parse(e.data||'{}');}catch{data={};}
  if(type==='session_update' && Array.isArray(data.partitions)){
   const s=state.projects.flatMap(p=>p.sessions).find(x=>x.id===id);
   if(!s) return;
   const vis=p=>p.role!=='clone';
   const before=(s.partitions||[]).filter(vis).map(p=>p.id).join(',');
   s.partitions=data.partitions;
   const after=(s.partitions||[]).filter(vis).map(p=>p.id).join(',');
   if(before!==after){
    if(chat.streaming||group.streaming) partitionsDirty=true;
    else render();
   }
   return;
  }
  const part=(session()?.partitions||[]).find(p=>p.id===selectedPartition);
  applySessionEvent(type,data,{
   sessionId:id,
   selectedPartition,
   viewingManager:Boolean(selectedPartition && isManagerPart(part)),
  });
 };
 for(const type of ['group_timeline','group_event','clone_result','dispatch_result','session_update','text_delta','agent_done','hitl_request','hitl_resolved','question','tool_call','tool_result']){
  sessionEvents.addEventListener(type,on(type));
 }
}
function inGroupChat(sessionId){
 return selectedSession===sessionId && page==='workspace' && !selectedPartition;
}
function applyEffortFromConnection(connection, group, source){
 const view=managerSelectionView(connection||{}, group||'', source||null);
 chat.effortLevels=view.levels||[];
 if(!chat.effort && view.effort) chat.effort=view.effort;
 if(chat.effort && chat.effortLevels.length && !chat.effortLevels.includes(chat.effort)) chat.effort=view.effort||'';
}

function groupChatPanel(s,p){
 const conn=findConnection(state.manager?.connectionId);
 const group=connectionGroups(conn||{})[0]||managerSeriesId({manager:state.manager});
 applyEffortFromConnection(conn, group, state.manager);
 return groupPanel({session:s, projectPath:p?.path||'', managerReady:Boolean(state.manager?.model), managerLabel:managerActorLabel(state)});
}
function setSessionListOpen(sessionId, shouldOpen, details){
 if(shouldOpen) open.add(sessionId);
 else open.delete(sessionId);
 if(details) details.open=shouldOpen;
}

function projectMenuItems(p){
 const live=(p.sessions||[]).filter(s=>!s.archived);
 const archived=(p.sessions||[]).filter(s=>s.archived);
 const archiveBtn=live.length || !archived.length
  ? `<button type="button" role="menuitem" data-action="archive-project" data-id="${p.id}" data-archived="1">${icons.archive}<span>归档聊天</span></button>`
  : `<button type="button" role="menuitem" data-action="archive-project" data-id="${p.id}" data-archived="0">${icons.archive}<span>取消归档</span></button>`;
 return `<div class="project-menu" role="menu" aria-label="项目操作">
  <button type="button" role="menuitem" data-action="pin-project" data-id="${p.id}">${icons.pin}<span>${p.pinned?'取消置顶':'置顶'}</span></button>
  <button type="button" role="menuitem" data-action="rename-project" data-id="${p.id}">${icons.edit}<span>编辑</span></button>
  <div class="project-menu-sep"></div>
  <button type="button" role="menuitem" data-action="reveal-project" data-id="${p.id}">${icons.folder}<span>在访达 / 资源管理器中打开</span></button>
  <button type="button" role="menuitem" data-action="relocate-project" data-id="${p.id}">${icons.folder}<span>更改项目位置</span></button>
  ${archiveBtn}
  <div class="project-menu-sep"></div>
  <button type="button" role="menuitem" class="danger" data-action="remove-project" data-id="${p.id}">${icons.close}<span>移除项目</span></button>
 </div>`;
}

function sessionRow(s){
 const parts=listedParts(s);
 const selected=s.id===selectedSession;
 return `<details class="session-item" data-open="${s.id}" ${open.has(s.id)?'open':''}>
  <summary data-session="${s.id}" class="${selected?'selected':''}" title="${esc(s.name)}"><span class="tree-caret" aria-hidden="true"></span><span class="tree-row-name">${esc(s.name)}</span></summary>
  <div class="sessions ai-list">${parts.map(a=>{
   const actor=isManagerPart(a)?managerActorLabel(state):'';
   return `<button type="button" class="part${a.id===selectedPartition?' selected':''}${isManagerPart(a)?' is-manager':''}" data-action="select" data-session="${s.id}" data-id="${a.id}">◇ ${esc(a.name)}${actor?`<small>${esc(actor)}</small>`:''}</button>`;
  }).join('')||'<div class="empty-sessions muted">还没有管理者 AI</div>'}</div>
 </details>`;
}

function tree(){
 const projects=[...state.projects].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
 return projects.map(p=>{
  const live=(p.sessions||[]).filter(s=>!s.archived);
  const archived=(p.sessions||[]).filter(s=>s.archived);
  const archivedBlock=archived.length?`<details class="archived-sessions"><summary>已归档 ${archived.length}</summary><div class="sessions">${archived.map(sessionRow).join('')}</div></details>`:'';
  return `<details class="project-item${projectMenu===p.id?' is-menu-open':''}${p.pinned?' is-pinned':''}" data-open="${p.id}" ${open.has(p.id)?'open':''}>
   <summary title="${esc(p.path)}">
    <span class="tree-row">
     <span class="tree-caret" aria-hidden="true"></span>
     ${p.pinned?`<span class="tree-pin" title="已置顶">${icons.pin}</span>`:''}
     <span class="tree-row-name">${esc(p.name)}</span>
     <span class="tree-row-actions">
      <button type="button" class="tree-icon-btn" data-action="project-menu" data-id="${p.id}" aria-label="项目菜单" aria-haspopup="menu" aria-expanded="${projectMenu===p.id}">${icons.more}</button>
      <button type="button" class="tree-icon-btn" data-action="new-session" data-id="${p.id}" aria-label="新建会话" title="新建会话">${icons.edit}</button>
     </span>
    </span>
    ${projectMenu===p.id?projectMenuItems(p):''}
   </summary>
   <div class="sessions">${live.length?live.map(sessionRow).join(''):'<div class="empty-sessions muted">还没有会话</div>'}${archivedBlock}</div>
  </details>`;
 }).join('');
}

function placeFloating(el, anchor, {align='left'}={}){
 if(!el||!anchor)return;
 const r=anchor.getBoundingClientRect();
 const w=el.offsetWidth||220;
 const h=el.offsetHeight||200;
 let top=r.bottom+4;
 if(top+h>window.innerHeight-8) top=Math.max(8,r.top-h-4);
 let left=align==='right' ? r.right-w : r.left;
 left=Math.max(8,Math.min(left, window.innerWidth-w-8));
 el.style.top=top+'px';
 el.style.left=left+'px';
}
function placeProjectMenu(){
 if(!projectMenu)return;
 placeFloating($('.project-menu'), document.querySelector(`[data-action="project-menu"][data-id="${CSS.escape(projectMenu)}"]`), {align:'right'});
}
function placeWorkspacePopovers(){
 if(sessionMenu) placeFloating($('.session-menu'), document.querySelector('[data-action="session-menu"]'));
 if(summaryOpen) placeFloating($('.summary-popover'), document.querySelector('[data-action="toggle-summary"]'), {align:'right'});
 if(filePickerOpen) placeFloating($('.file-picker'), document.querySelector('[data-action="toggle-file-picker"]'));
}
function closeWorkspacePopovers(){
 sessionMenu=false;
 summaryOpen=false;
 filePickerOpen=false;
}
function fileLabel(filePath){
 const normalized=String(filePath||'').replace(/\\/g,'/');
 const parts=normalized.split('/').filter(Boolean);
 return parts[parts.length-1]||normalized;
}
function resetWorkspaceTabs(){
 workspaceTab='conversation';
 openFiles=[];
 filePreviews.clear();
 summaryOpen=false;
 summaryAll=false;
 summaryData={outputs:[],sources:[]};
 filePickerOpen=false;
 filePickerDir='.';
 filePickerEntries=[];
 filePickerParent='';
 sessionMenu=false;
}
function showConversation(){
 workspaceTab='conversation';
 closeWorkspacePopovers();
}
async function openFileTab(filePath){
 const p=String(filePath||'').trim();
 if(!p)return;
 if(!openFiles.some(f=>f.path===p)) openFiles.push({path:p,name:fileLabel(p)});
 workspaceTab=p;
 closeWorkspacePopovers();
 if(!filePreviews.has(p) || filePreviews.get(p)?.error){
  filePreviews.set(p,{loading:true});
 }
 render();
 if(!selectedSession)return;
 try{
  const preview=await api('workspace/file',{sessionId:selectedSession,path:p});
  filePreviews.set(p,preview);
  if(preview.name) {
   const tab=openFiles.find(f=>f.path===p);
   if(tab) tab.name=preview.name;
  }
 }catch(err){
  filePreviews.set(p,{ok:false,error:err.message});
 }
 render();
}
function mergeLiveArtifacts(base){
 const out={outputs:[...(base.outputs||[])],sources:[...(base.sources||[])]};
 const seen={output:new Set(out.outputs.map(item=>String(item.path||'').replace(/\\/g,'/').toLowerCase())),source:new Set(out.sources.map(item=>String(item.path||'').replace(/\\/g,'/').toLowerCase()))};
 for(const message of chat.messages||[]){
  for(const tc of message.toolCalls||[]){
   const filePath=toolFilePath(tc);
   if(!filePath) continue;
   const name=String(tc.name||'');
   const kind=/write|replace|edit|apply_patch|NotebookEdit/i.test(name)?'output':/read|view_file|grep|glob|find_by|list_dir/i.test(name)?'source':'';
   if(!kind) continue;
   const key=filePath.replace(/\\/g,'/').toLowerCase();
   if(seen[kind].has(key)) continue;
   seen[kind].add(key);
   (kind==='output'?out.outputs:out.sources).push({path:filePath,name:fileLabel(filePath)});
  }
 }
 return out;
}
async function loadSummary(){
 if(!selectedSession) return;
 try{
  summaryData=mergeLiveArtifacts(await api('session/artifacts',{sessionId:selectedSession}));
 }catch(err){
  notice(err.message);
  summaryData=mergeLiveArtifacts({outputs:[],sources:[]});
 }
}
async function loadFilePicker(dir){
 if(!selectedSession) return;
 filePickerDir=dir||'.';
 try{
  const listed=await api('workspace/list',{sessionId:selectedSession,path:filePickerDir});
  filePickerDir=listed.relative || '.';
  filePickerParent=listed.parent || '';
  filePickerEntries=listed.entries||[];
 }catch(err){
  notice(err.message);
  filePickerEntries=[];
 }
}
function closeFileTab(filePath){
 openFiles=openFiles.filter(f=>f.path!==filePath);
 filePreviews.delete(filePath);
 if(workspaceTab===filePath) workspaceTab='conversation';
}
function joinRel(base, name){
 const b=String(base||'').replace(/\\/g,'/').replace(/\/+$/,'');
 if(!b || b==='.') return name;
 return b+'/'+name;
}
function fileCrumbs(preview, filePath){
 const rel=String(preview?.relative||filePath||'').replace(/\\/g,'/');
 const parts=rel.split('/').filter(part=>part && part!=='.');
 if(!parts.length) return '<span class="file-crumb">.</span>';
 return parts.map(part=>`<span class="file-crumb">${esc(part)}</span>`).join('<span class="file-crumb-sep">/</span>');
}
function filePane(filePath){
 const preview=filePreviews.get(filePath);
 let body='';
 if(!preview || preview.loading){
  body='<p class="muted file-placeholder">正在打开…</p>';
 }else if(preview.kind==='directory'){
  const entries=preview.entries||[];
  body=entries.length
   ? `<div class="file-dir">${entries.map(entry=>{
      const child=joinRel(preview.relative||filePath, entry.name);
      return `<button type="button" class="file-dir-item" data-action="open-file" data-id="${esc(child)}">${esc(entry.name)}${entry.type==='directory'?'/':''}</button>`;
     }).join('')}</div>`
   : '<p class="muted file-placeholder">空目录</p>';
 }else if(preview.kind==='too_large' || preview.kind==='binary' || !preview.ok){
  body=`<p class="muted file-placeholder">${esc(preview.error||'无法预览此文件')}</p>`;
 }else{
  body=`<pre class="file-pre">${esc(preview.content||'')}</pre>`;
 }
 return `<div class="file-page" data-file-page>
  <div class="file-toolbar"><div class="file-crumbs">${fileCrumbs(preview,filePath)}</div></div>
  <div class="file-body">${body}</div>
 </div>`;
}
function sessionMenuItems(){
 return `<div class="session-menu project-menu" role="menu" aria-label="会话操作">
  <button type="button" role="menuitem" data-action="rename-session">${icons.edit}<span>重命名</span></button>
 </div>`;
}
function summaryList(items, empty){
 const list=summaryAll?items:items.slice(0,8);
 if(!list.length) return `<p class="muted summary-empty">${empty}</p>`;
 return list.map(item=>`<button type="button" class="summary-item" data-action="open-file" data-id="${esc(item.path)}"><span>${esc(item.name)}</span><small>${esc(item.path)}</small></button>`).join('');
}
function summaryPopover(){
 const outputs=summaryData.outputs||[];
 const sources=summaryData.sources||[];
 const hidden=!summaryAll && (outputs.length>8 || sources.length>8);
 return `<div class="summary-popover" role="dialog" aria-label="摘要">
  <section class="summary-section">
   <div class="summary-head"><strong>输出内容</strong><button type="button" class="icon-button" data-action="toggle-file-picker" aria-label="打开文件">${icons.plus}</button></div>
   ${summaryList(outputs,'还没有写入的文件')}
   <button type="button" class="summary-create" data-action="toggle-file-picker">创建文件或站点</button>
  </section>
  <section class="summary-section">
   <div class="summary-head"><strong>来源</strong></div>
   ${summaryList(sources,'还没有读取的文件')}
  </section>
  ${hidden?`<button type="button" class="summary-more" data-action="summary-more">查看全部</button>`:''}
 </div>`;
}
function filePicker(){
 const rows=[];
 if(filePickerParent){
  rows.push(`<button type="button" class="file-picker-item" data-action="picker-enter" data-id="${esc(filePickerParent)}">../</button>`);
 }
 const dirs=filePickerEntries.filter(entry=>entry.type==='directory');
 const files=filePickerEntries.filter(entry=>entry.type!=='directory');
 for(const entry of [...dirs, ...files]){
  const target=entry.relative||entry.path||entry.name;
  const act=entry.type==='directory'?'picker-enter':'open-file';
  const kind=fileKind(entry.name, entry.type);
  const mark=kind==='directory'?icons.folder:icons.generic;
  rows.push(`<button type="button" class="file-picker-item" data-action="${act}" data-id="${esc(target)}"><span class="file-kind" aria-hidden="true">${mark}</span><span>${esc(entry.name)}${entry.type==='directory'?'/':''}</span></button>`);
 }
 return `<div class="file-picker" role="dialog" aria-label="打开文件">
  <form class="file-picker-form" data-picker-form>
   <input name="path" value="${esc(filePickerDir==='.'?'':filePickerDir)}" placeholder="项目内路径" autocomplete="off">
  </form>
  <div class="file-picker-list">${rows.join('')||'<p class="muted">这个目录是空的</p>'}</div>
 </div>`;
}
function workspaceTabs(s){
 if(!s) return '<strong>Skerry</strong>';
 const convActive=workspaceTab==='conversation';
 const files=openFiles.map(f=>`<div class="ws-tab${workspaceTab===f.path?' is-active':''}" data-action="workspace-tab" data-id="${esc(f.path)}" role="tab" aria-selected="${workspaceTab===f.path}" title="${esc(f.path)}"><span class="ws-tab-label">${esc(f.name)}</span><button type="button" class="ws-tab-x" data-action="close-file" data-id="${esc(f.path)}" aria-label="关闭 ${esc(f.name)}">×</button></div>`).join('');
 return `<div class="workspace-tabs" role="tablist" aria-label="工作区页签">
  <div class="ws-tab ws-tab-conversation${convActive?' is-active':''}" data-action="workspace-tab" data-id="conversation" role="tab" aria-selected="${convActive}" title="${esc(s.name)}"><span class="ws-tab-label">${esc(s.name)}</span><button type="button" class="ws-tab-more" data-action="session-menu" aria-label="会话操作" aria-haspopup="menu" aria-expanded="${sessionMenu}">${icons.more}</button></div>
  ${files}
  <button type="button" class="icon-button ws-tab-add" data-action="toggle-file-picker" aria-label="打开文件" title="打开文件" aria-expanded="${filePickerOpen}">${icons.plus}</button>
 </div>`;
}

function workspace(){
 const s=session(),p=state.projects.find(p=>p.sessions.some(x=>x.id===s?.id)),a=s?.partitions.find(p=>p.id===selectedPartition);
 if(!s){
  if(state.projects.length){
   return `<div class="welcome"><div class="symbol"><img src="/icons/skerry.svg" alt="" aria-hidden="true"></div><div class="eyebrow">LOCAL WORKSPACE</div><h1>打开会话进入工作区</h1><p class="muted">在左侧展开项目并点选会话，中间显示对话。<br>扩展在主工作区内打开，用来管理分区和工具。</p></div>`;
  }
  const root=state.layout?.workspaceRoot||'';
  return `<div class="welcome"><div class="symbol"><img src="/icons/skerry.svg" alt="" aria-hidden="true"></div><div class="eyebrow">LOCAL WORKSPACE</div><h1>从一个本地项目开始</h1><p class="muted">项目放在工作区母目录下，不要直接摊在 Downloads 根上。<br>${root?`当前母目录：${esc(root)}`:''}</p><button class="primary" data-action="project">选择本地项目</button><button class="secondary" data-action="change-workspace-root">更改工作区母目录</button></div>`;
 }
 if(workspaceTab!=='conversation' && openFiles.some(f=>f.path===workspaceTab)){
  return filePane(workspaceTab);
 }
 if(!selectedPartition || !a){
  return `<div class="chat-page">${groupChatPanel(s,p)}</div>`;
 }
 const managerReady=Boolean(state.manager?.model);
 const talkingManager=isManagerPart(a);
 const actor=managerActorLabel(state);
 const routes=talkingManager
  ? `<div class="chat-routes muted">${esc(p.path)} · 管理者AI${actor?` · ${esc(actor)}`:''}</div>`
  : `<div class="chat-routes muted">${a.routes.map(r=>{const c=[...state.connections,...state.official].find(c=>c.id===r.connectionId);return `${esc(c?.name||'连接不可用')} · ${esc(r.model)}`;}).join(' · ')}</div>`;
 if(talkingManager){
  const conn=findConnection(state.manager?.connectionId);
  const group=connectionGroups(conn||{})[0]||managerSeriesId({manager:state.manager});
  applyEffortFromConnection(conn, group, state.manager);
 }else if(a?.routes?.[0]){
  const conn=findConnection(a.routes[0].connectionId);
  const group=connectionGroups(conn||{})[0];
  applyEffortFromConnection(conn, group, a.routes[0]);
 }
 return `<div class="chat-page">${routes}${chatPanel({session:s,partition:talkingManager?null:a,managerReady, managerLabel:talkingManager?actor:''})}</div>`;
}

function extensionPane(){
 const s=session();
 if(!s) return '';
 const partitions=listedParts(s);
 const tools=chatToolCards();
 const a=s.partitions.find(p=>p.id===selectedPartition);
 const worker=a&&!isManagerPart(a);
 const live=liveTasks();
 const execTasks=worker?group.events.filter(e=>e.type==='task'&&e.partitionId===a.id):[];
 const taskSection=worker
  ? renderTaskBox(s.id,a.id,execTasks)
  : `<div data-context-tasks>${renderLiveBoard(s.id,live)}</div>`;
 const partitionBody=partitions.length
  ? partitions.map(part=>{
     const actor=isManagerPart(part)?managerActorLabel(state):'';
     return `<button type="button" class="extension-item ${part.id===selectedPartition?'selected':''}${isManagerPart(part)?' is-manager':''}" data-action="select" data-session="${s.id}" data-id="${part.id}"><span>◇ ${esc(part.name)}</span><small>${isManagerPart(part)?(actor||'管理者'):`${part.routes.length} 路`}</small></button>`;
    }).join('')
  : '<p class="muted extension-empty">这个会话还没有管理者 AI。</p>';
 const toolBody=tools.length
  ? tools.map(t=>{
     const filePath=toolFilePath(t);
     const open=filePath?` data-action="open-file" data-id="${esc(filePath)}"`:'';
     return `<article class="extension-item tool"${open}><strong>${esc(t.name)}</strong><small>${esc(String(t.args.command||t.args.path||t.args.file||t.args.prompt||filePath||'').slice(0,80))}</small></article>`;
    }).join('')
  : '<p class="muted extension-empty">对话里用到的工具会列在这里。</p>';
 return `<aside class="extension-pane" aria-label="扩展区域">
  <div class="extension-head">
   <div class="extension-tabs" role="tablist" aria-label="扩展分类">
    <button type="button" role="tab" class="${extensionTab==='partitions'?'active':''}" data-action="extension-tab" data-id="partitions" aria-selected="${extensionTab==='partitions'}">分区</button>
    <button type="button" role="tab" class="${extensionTab==='tools'?'active':''}" data-action="extension-tab" data-id="tools" aria-selected="${extensionTab==='tools'}">工具</button>
   </div>
   <button type="button" class="icon-button" data-action="toggle-extension" aria-label="隐藏扩展区域" title="隐藏扩展区域">×</button>
  </div>
  <div class="extension-body">${taskSection}${extensionTab==='tools'?toolBody:partitionBody}</div>
 </aside>`;
}

function terminalDock(){
 if(!terminalOpen)return '';
 const log=chatTerminalLog();
 return `<section class="terminal-dock is-open" data-terminal>
  <div class="terminal-head">
   <span class="terminal-toggle-label">${icons.terminal}<span>终端</span></span>
   <button type="button" class="icon-button" data-action="toggle-terminal" aria-label="隐藏终端" title="隐藏终端 (Ctrl+\`)">×</button>
  </div>
  <div id="workbench-terminal" class="terminal-body">
   <pre class="terminal-log">${log?esc(log):'<span class="terminal-placeholder">Agent 执行的命令会显示在这里。</span>'}</pre>
  </div>
 </section>`;
}

function workbench(){
 const s=session();
 const liveCount=liveTasks().length;
 const pane=s&&extensionOpen;
 return `<div class="app" data-workbench>
  <div class="workbench-body">
   <aside class="sidebar">
    <button class="brand" data-action="workspace" aria-label="Skerry 首页"><span class="brand-logo">${icons.logo}</span><span>Skerry<span class="brand-subtitle">WORKSPACE</span></span></button>
    <div class="sidehead"><strong>本地项目</strong><button title="选择本地项目" aria-label="选择本地项目" data-action="project">＋</button></div>
    <div class="project-tree">${state.projects.length?tree():'<div class="empty-side">还没有本地项目<br>点击 ＋ 选择项目文件夹</div>'}</div>
    ${footer(state)}
   </aside>
   <div class="work-column">
    <main class="main${s?' chat-main':''}" aria-label="工作区域">
     <header>
      ${workspaceTabs(s)}
      <div class="header-actions">
       ${s?`<button type="button" class="text-button summary-toggle" data-action="toggle-summary" aria-pressed="${summaryOpen}" aria-expanded="${summaryOpen}">切换摘要</button>`:''}
       <button type="button" class="icon-button terminal-toggle-btn" data-action="toggle-terminal" aria-pressed="${terminalOpen}" aria-expanded="${terminalOpen}" aria-label="${terminalOpen?'隐藏终端':'打开终端'}" title="终端 (Ctrl+\`)">${icons.terminal}</button>
       <button type="button" class="icon-button extension-toggle" data-action="toggle-extension" aria-pressed="${Boolean(pane)}" aria-label="${pane?'隐藏扩展区域':'显示扩展区域'}" title="扩展区域">${icons.panel}${liveCount?`<span class="ext-live-count">${liveCount}</span>`:''}</button>
      </div>
      ${s&&sessionMenu?sessionMenuItems():''}
      ${s&&filePickerOpen?filePicker():''}
      ${summaryOpen?summaryPopover():''}
     </header>
     <div class="content${s?' chat-content':' work-empty'}">${workspace()}${pane?'<button type="button" class="extension-backdrop" data-action="toggle-extension" aria-label="关闭扩展区域"></button>':''}${pane?extensionPane():''}</div>
    </main>
    ${terminalDock()}
   </div>
  </div>
 </div>`;
}

function findConnection(id){
 return state.connections.find(c=>c.id===id)||state.official.find(c=>c.id===id);
}

function managerSnapshot(payload){
 return {
  connectionId:payload.connectionId,
  model:payload.model,
  effort:payload.effort||'',
  contextWindow:payload.contextWindow??'',
 };
}

function managerEqual(a,b){
 if(!a||!b)return false;
 return a.connectionId===b.connectionId
  && a.model===b.model
  && (a.effort||'')===(b.effort||'')
  && String(a.contextWindow??'')===String(b.contextWindow??'');
}

async function refreshManagerView(){
 if(!selectedSession) return;
 if(chat.streaming||group.streaming) return;
 const s=session();
 if(!s) return;
 const part=(s.partitions||[]).find(p=>p.id===selectedPartition);
 const viewingManager=Boolean(selectedPartition&&isManagerPart(part));
 if(!viewingManager) return;
 try{await loadChatHistory(api,selectedSession,workerChatId());}
 catch{ /* 下一次点开管理者 AI 会再拉 */ }
}

async function saveManager(payload, opts={}){
 const connectionId=String(payload.connectionId||'').trim();
 const model=String(payload.model||'').trim();
 if(!connectionId||!model)throw new Error('请先选择型号');
 const body={connectionId,model};
 if(payload.effort) body.effort=String(payload.effort).trim();
 if(payload.contextWindow!==undefined&&payload.contextWindow!==null&&String(payload.contextWindow).trim()!==''){
  body.contextWindow=payload.contextWindow;
 }
 if(managerEqual(managerSnapshot(state.manager||{}), managerSnapshot(body))) return false;
 const result=await api('manager',body);
 state.manager=result.manager;
 if(result.managerSelections) state.managerSelections=result.managerSelections;
 if(opts.notice!==false) notice('已设为管理者 AI');
 await refreshManagerView();
 if(opts.render!==false) render();
 return true;
}

function payloadFromManagerCard(card){
 const group=card.dataset.group||'';
 const active=group?activeProviderForGroup(state, group):null;
 return {
  connectionId:active?.id||card.dataset.id,
  model:String(card.querySelector('[name=managerModel]')?.value||'').trim(),
  effort:String(card.querySelector('[name=managerEffort]')?.value||'').trim(),
  contextWindow:String(card.querySelector('[name=managerContext]')?.value||'').trim(),
 };
}

function applyCardModelDefaults(card){
 const group=card.dataset.group||'';
 const active=group?activeProviderForGroup(state, group):null;
 const connectionId=active?.id||card.dataset.id;
 const conn=findConnection(connectionId);
 const model=String(card.querySelector('[name=managerModel]')?.value||'').trim();
 const view=managerSelectionView(conn, group, {connectionId,model});
 const effort=card.querySelector('[name=managerEffort]');
 const context=card.querySelector('[name=managerContext]');
 if(effort){
  const allowed=view.levels?.length?view.levels:REASONING_LEVELS;
  const current=allowed.includes(effort.value)?effort.value:view.effort;
  effort.innerHTML=`<option value="">未设置</option>${allowed.map(level=>`<option value="${level}" ${level===current?'selected':''}>${REASONING_LABELS[level]||level} (${level})</option>`).join('')}`;
 }
 if(context) context.value=view.contextWindow??'';
 card.dataset.lastModel=model;
}

function kbd(keys){
 return `<span class="shortcut-keys">${keys.map(k=>`<kbd>${esc(k)}</kbd>`).join('<span class="shortcut-plus">+</span>')}</span>`;
}
function shortcutsPage(){
 const mod=/Mac|iPhone|iPad/.test(navigator.userAgent||'')?'⌘':'Ctrl';
 return `
  <div class="cc-settings-container">
   <div class="cc-settings-header">
    <h1>快捷键</h1>
    <p class="muted">工作台当前可用的键盘快捷方式。</p>
   </div>
   <section class="shortcut-group">
    <h2>工作区</h2>
    <div class="shortcut-list">
     <div class="shortcut-row"><span>打开 / 隐藏终端</span>${kbd([mod,'`'])}</div>
    </div>
   </section>
   <section class="shortcut-group">
    <h2>对话</h2>
    <div class="shortcut-list">
     <div class="shortcut-row"><span>发送消息</span>${kbd(['Enter'])}</div>
     <div class="shortcut-row"><span>换行</span>${kbd(['Shift','Enter'])}</div>
    </div>
   </section>
  </div>
 `;
}

function settings(){
 if(settingsTab==='shortcuts') return shortcutsPage();
 const group=MODEL_GROUPS.find(g=>g.id===activeModelGroup)||MODEL_GROUPS[0];
 const pills=accountSwitcher(settingsTab);
 const header=`
  <div class="cc-settings-header">
   <h1>模型选择</h1>
  </div>
  ${pills}
 `;
 if(settingsTab==='manager'){
  return `
  <div class="cc-settings-container">
   ${header}
   ${managerCards(state)}
  </div>
  `;
 }

 const rawConnections=connectionsInGroup(state.connections,group.id);
 const rawOfficial=connectionsInGroup(state.official,group.id);
 const picked=activeProviderForGroup(state, activeModelGroup);
 const pickedReady=picked && (String(picked.id||'').startsWith('official-') ? picked.connected && !picked.expired : true);
 const activeProviderId=pickedReady ? picked.id : (rawOfficial.find(o=>o.connected&&!o.expired)?.id || rawConnections.find(c=>c.hasKey)?.id);
 const tabRow=`
  <div class="cc-tab-row">
   ${appSwitcher(activeModelGroup,MODEL_GROUPS)}
   <button type="button" class="cc-add-btn" data-action="add-provider" title="添加供应商" aria-label="添加供应商">${icons.plus}</button>
  </div>
 `;

 const cards=[
  ...rawOfficial.map(c=>renderOfficialCard(c,activeModelGroup,c.id===activeProviderId,speedResults.get(c.id))),
  ...rawConnections.map(c=>renderProviderCard(c,activeModelGroup,c.id===activeProviderId,speedResults.get(c.id))),
 ];
 const listContent=cards.length
  ? `<div class="cc-provider-list">${cards.join('')}</div>`
  : renderEmptyState(group.name);

 return `
  <div class="cc-settings-container">
   ${header}
   ${tabRow}
   ${listContent}
  </div>
 `;
}

function render(){
 document.querySelectorAll('details[data-open]').forEach(d=>{if(d.open)open.add(d.dataset.open);else open.delete(d.dataset.open)});
 if(page==='settings'){
  $('#app').innerHTML=settingsShell(settings(), settingsTab);
 }else{
  $('#app').innerHTML=workbench();
  const term=$('.terminal-log');
  if(term) term.scrollTop=term.scrollHeight;
  scrollChatToLatest();
  fitCompose(document.querySelector('[data-chat-form] textarea'));
  placeProjectMenu();
  placeWorkspacePopovers();
  if(selectedSession) watchSessionEvents(selectedSession);
 }
 document.title=page==='settings'?'设置 · Skerry':'Skerry';
}

function navigate(next,tab='providers') {
 page=next;
 if(next==='settings'){
  settingsTab=['providers','manager','shortcuts'].includes(tab)?tab:'providers';
  if(settingsTab!=='shortcuts') lastModelTab=settingsTab;
  history.pushState(null,'','#settings/'+settingsTab);
 }else{
  history.pushState(null,'','#workspace');
 }
 render();
}

window.addEventListener('popstate',()=>{
 page=location.hash.startsWith('#settings')?'settings':'workspace';
 settingsTab=parseSettingsTab(location.hash);
 if(settingsTab!=='shortcuts') lastModelTab=settingsTab;
 render();
});

function dialog(content,onSubmit){
 const d=document.createElement('dialog');
 d.innerHTML=`<form method="dialog">${content}<div class="row"><button class="primary" type="submit">确定</button><button type="button" data-close>取消</button></div></form>`;
 document.body.append(d);
 d.querySelector('[data-close]').onclick=()=>d.close();
 d.onclose=()=>d.remove();
 d.querySelector('form').onsubmit=async e=>{
  e.preventDefault();
  const btn=d.querySelector('[type=submit]');
  btn.disabled=true;
  try{await onSubmit(Object.fromEntries(new FormData(e.target)));d.close();await refresh();}
  catch(e){notice(e.message);}
  finally{btn.disabled=false;}
 };
 d.showModal();
 return d;
}

function openEditModal(conn){
 openProviderModal({
  connection:conn,
  activeGroup:activeModelGroup,
  onSave:async payload=>{
   state=await api('connection',payload);
   notice('供应商已保存');
   render();
  },
  onTest:async data=>{
   const config=data.modelConfig||{};
   const model=stripClaudeOneMMarker(resolveRequestModel(config));
   if(!model)throw new Error('请先在配置中指定默认模型标识');
   if(!data.id){
    return await api('test',{id:'',model,effort:config.defaultEffort||'',sessionId:selectedSession||undefined,baseUrl:data.baseUrl,protocol:data.protocol,key:data.key});
   }
   return await api('test',{id:data.id,model,effort:config.defaultEffort||'',sessionId:selectedSession||undefined});
  },
  onFetchModels:async data=>{
   const body={id:data.id||''};
   if(data.baseUrl) body.baseUrl=data.baseUrl;
   if(data.protocol) body.protocol=data.protocol;
   if(data.key) body.key=data.key;
   if(data.modelsUrl) body.modelsUrl=data.modelsUrl;
   return await api('models',body);
  }
 });
}

const polling=new Map();
function stopLoginWatch(id){
 if(!polling.has(id))return;
 const job=polling.get(id);
 clearTimeout(job.timer);
 polling.delete(id);
}
function openAuthWindow(){
 try{
  const w=window.open('','skerry-oauth');
  if(w){
   try{
    w.document.open();
    w.document.write('<!doctype html><meta charset="utf-8"><title>正在打开授权</title><p style="font-family:sans-serif;padding:24px">正在跳转到授权页面…</p>');
    w.document.close();
   }catch{ /* 随后用授权地址替换 */ }
  }
  return w;
 }catch{return null;}
}

async function watchLogin(id,result){
 stopLoginWatch(id);
 let attempts=0;
 const device=result.flow==='device';
 const wait=()=>Math.max(5,Number(result.interval)||5)*1000;
 const job={timer:0};
 const tick=async()=>{
  if(document.hidden){
   job.timer=setTimeout(tick,wait());
   return;
  }
  try{
   if(device)await api('auth/poll',{id,transactionId:result.transactionId});
   const latest=await api('state');
   const c=latest.official.find(item=>item.id===id);
   const transaction=c?.transaction?.transactionId===result.transactionId?c.transaction:null;
   const completed=['cli','external'].includes(result.flow)
    ? c?.connected&&!c.expired
    : transaction?.status==='completed'&&c?.connected&&!c.expired;
   if(completed){
    stopLoginWatch(id);
    state=latest;
    render();
    notice(c?.email?`已登录 ${c.email}`:'官方账号登录成功');
    return;
   }
   if(transaction?.status==='error'){
    stopLoginWatch(id);
    notice('官方登录失败：'+(transaction.error?.message||'请重新登录'));
    return;
   }
   if(++attempts>120){
    stopLoginWatch(id);
    notice('登录等待结束，可重新登录');
    return;
   }
   job.timer=setTimeout(tick,wait());
  }catch(e){
   stopLoginWatch(id);
   notice('登录未完成：'+e.message);
  }
 };
 polling.set(id,job);
 job.timer=setTimeout(tick,wait());
}

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');
 if(projectMenu && !e.target.closest('.project-menu') && b?.dataset.action!=='project-menu'){
  projectMenu='';
  if(!b){render();return;}
 }
 const popoverRoot=e.target.closest('.session-menu,.summary-popover,.file-picker');
 const popoverToggle=['session-menu','toggle-summary','toggle-file-picker'].includes(b?.dataset.action);
 if((sessionMenu||summaryOpen||filePickerOpen) && !popoverRoot && !popoverToggle){
  closeWorkspacePopovers();
  if(!b){render();return;}
 }
 if(chat.modeMenuOpen && !e.target.closest('.compose-mode-wrap')){
  chat.modeMenuOpen=false;
  if(!b){patchCompose();return;}
  if(b.dataset.action!=='chat-mode' && b.dataset.action!=='chat-mode-set') patchCompose();
 }
 if(!b)return;
 const {action,id}=b.dataset;
 if(action==='toggle-terminal'){terminalOpen=!terminalOpen;render();return;}
 if(action==='toggle-extension'){extensionOpen=!extensionOpen;render();return;}
 if(action==='extension-tab'){extensionTab=id;render();return;}
 if(action==='workspace-tab'){
  if(id==='conversation') showConversation();
  else if(openFiles.some(f=>f.path===id)){workspaceTab=id;closeWorkspacePopovers();}
  render();
  return;
 }
 if(action==='close-file'){
  e.preventDefault();
  e.stopPropagation();
  closeFileTab(id);
  render();
  return;
 }
 if(action==='open-file'){
  await openFileTab(id);
  return;
 }
 if(action==='session-menu'){
  e.preventDefault();
  e.stopPropagation();
  const next=!sessionMenu;
  closeWorkspacePopovers();
  sessionMenu=next;
  render();
  return;
 }
 if(action==='toggle-summary'){
  const next=!summaryOpen;
  closeWorkspacePopovers();
  summaryOpen=next;
  if(summaryOpen) await loadSummary();
  render();
  return;
 }
 if(action==='summary-more'){
  summaryAll=true;
  render();
  return;
 }
 if(action==='toggle-file-picker'){
  const next=!filePickerOpen;
  closeWorkspacePopovers();
  filePickerOpen=next;
  if(filePickerOpen) await loadFilePicker(filePickerDir||'.');
  render();
  return;
 }
 if(action==='picker-enter'){
  await loadFilePicker(id);
  filePickerOpen=true;
  render();
  return;
 }
 if(action==='rename-session'){
  const current=session();
  closeWorkspacePopovers();
  render();
  if(current){
   dialog(`<h2>重命名会话</h2><label>会话名称<input name="name" required autofocus maxlength="100" value="${esc(current.name)}"></label>`,async values=>{
    state=await api('session/rename',{id:current.id,name:values.name});
    notice('会话名称已更新');
   });
  }
  return;
 }
 if(action==='open-task'){
  showConversation();
  selectedSession=b.dataset.session||selectedSession;
  selectedPartition=b.dataset.kind==='clone'? (managerPartId()||id) : id;
  page='workspace';
  resetChat();
  watchSessionEvents(selectedSession);
  Promise.all([
   loadChatHistory(api,selectedSession,workerChatId()),
   loadGroupHistory(api,selectedSession),
  ]).catch(err=>notice(err.message)).finally(()=>render());
  return;
 }
 if(action==='back-to-group'){
  showConversation();
  selectedSession=b.dataset.session||selectedSession;
  selectedPartition='';
  page='workspace';
  resetChat();
  watchSessionEvents(selectedSession);
  loadGroupHistory(api,selectedSession).catch(err=>notice(err.message)).finally(()=>render());
  return;
 }
 if(action==='settings-section'){
  navigate('settings', id==='shortcuts'?'shortcuts':lastModelTab);
  return;
 }
 if(action==='project-menu'){
  e.preventDefault();
  e.stopPropagation();
  projectMenu=projectMenu===id?'':id;
  render();
  return;
 }
 b.disabled=true;
 try{
  if(action==='settings'||action==='workspace'){navigate(action);}
  if(action==='settings-tab'){navigate('settings',id);}
  if(action==='model-group'){activeModelGroup=id;render();}
  if(action==='add-provider'){openEditModal(null);}
  if(action==='edit-provider'){
   const c=state.connections.find(x=>x.id===id)||state.official.find(x=>x.id===id);
   if(c)openEditModal(c);
  }
  if(action==='switch-provider'){
   const before=managerSnapshot(state.manager||{});
   state=await api('connection/activate',{id,group:activeModelGroup});
   notice('已启用为当前模型提供商');
   if(!managerEqual(before, managerSnapshot(state.manager||{}))) await refreshManagerView();
   render();
  }
  if(action==='copy-provider'){
   state=await api('connection/copy',{id});
   notice('已复制供应商');
   render();
  }
  if(action==='delete-provider'){
   const c=state.connections.find(x=>x.id===id);
   if(c&&confirm(`确定要删除供应商“${c.name}”吗？关联密钥将被彻底清理。`)){
    state=await api('connection/delete',{id});
    speedResults.delete(id);
    notice('供应商已删除');
    render();
   }
  }
  if(action==='test-provider'){
   const c=state.connections.find(x=>x.id===id)||state.official.find(x=>x.id===id);
   if(c){
    if(c.kind==='official'&&(!c.connected||c.expired||c.authError))throw new Error('请先登录官方账号后再测试模型');
    const cfg=c.modelConfigs?.[activeModelGroup]||{};
    const model=stripClaudeOneMMarker(resolveRequestModel(cfg)||cfg.defaultModel||cfg.env?.ANTHROPIC_MODEL||cfg.catalog?.[0]?.model||c.models?.[0]||'');
    if(!model)throw new Error('请先编辑并填写默认模型标识');
    speedResults.set(id,{loading:true});
    render();
    try{
     const r=await api('test',{id,model,effort:cfg.defaultEffort||'',sessionId:selectedSession||undefined});
     speedResults.set(id,{durationMs:r.durationMs||0,preview:r.preview||''});
     notice(`已向模型发送 hi，耗时 ${r.durationMs||0}ms${r.preview?`；返回：${r.preview}`:'；模型已响应'}`);
    }catch(err){
     speedResults.set(id,{error:err.message});
     notice(`测试失败：${err.message}`);
    }
    render();
   }
  }
  if(action==='project'){
   notice('请在系统文件夹选择器中选择本地项目');
   const before=new Set(state.projects.map(p=>p.id));
   state=await api('project',{path:state.layout?.workspaceRoot||''});
   const added=state.projects.find(p=>!before.has(p.id));
   if(added) open.add(added.id);
   render();
  }
  if(action==='change-workspace-root'){
   notice('请选择工作区母目录');
   state=await api('layout',{workspaceRoot:state.layout?.defaultWorkspaceRoot||''});
   notice(state.layout?.workspaceRoot?`工作区母目录：${state.layout.workspaceRoot}`:'已更新工作区母目录');
   render();
  }
  if(action==='relocate-project'){
   projectMenu='';
   notice('请选择该项目的新位置');
   state=await api('project/relocate',{id});
   notice('已更新项目位置');
   render();
  }
  if(action==='new-session'){
   e.preventDefault();
   state=await api('session',{projectId:id});
   const p=state.projects.find(p=>p.id===id);
   const created=(p?.sessions||[]).filter(s=>!s.archived).at(-1);
   if(created){
    resetWorkspaceTabs();
    selectedSession=created.id;
    selectedPartition='';
    open.add(id);
    open.add(created.id);
    resetChat();
    resetGroup();
    watchSessionEvents(created.id);
   }
   projectMenu='';
   page='workspace';
   notice('已打开新会话');
   render();
  }
  if(action==='session'){
   dialog('<h2>新建会话</h2><label>会话名称<input name="name" required autofocus placeholder="例如：项目开发"></label>',async values=>{
    state=await api('session',{...values,projectId:id});
    const p=state.projects.find(p=>p.id===id);
    const created=p.sessions.at(-1);
    selectedSession=created.id;
    selectedPartition='';
    open.add(id);
    open.add(selectedSession);
    page='workspace';
   });
  }
  if(action==='pin-project'){
   projectMenu='';
   state=await api('project/pin',{id});
   notice(state.projects.find(p=>p.id===id)?.pinned?'已置顶':'已取消置顶');
   render();
  }
  if(action==='rename-project'){
   const p=state.projects.find(x=>x.id===id);
   projectMenu='';
   render();
   if(p){
    dialog(`<h2>编辑项目</h2><label>项目名称<input name="name" required autofocus maxlength="100" value="${esc(p.name)}"></label>`,async values=>{
     state=await api('project/rename',{id,name:values.name});
     notice('项目名称已更新');
    });
   }
  }
  if(action==='reveal-project'){
   projectMenu='';
   render();
   await api('project/reveal',{id});
  }
  if(action==='archive-project'){
   const archived=b.dataset.archived!=='0';
   projectMenu='';
   state=await api('project/archive',{id,archived});
   const p=state.projects.find(x=>x.id===id);
   if(p && (p.sessions||[]).some(s=>s.id===selectedSession && s.archived)){
    selectedSession='';
    selectedPartition='';
    resetChat();
    resetWorkspaceTabs();
   }
   notice(archived?'已归档会话':'已取消归档');
   render();
  }
  if(action==='remove-project'){
   const p=state.projects.find(x=>x.id===id);
   projectMenu='';
   if(p && confirm(`确定要从工作台移除项目“${p.name}”吗？本地文件夹不会被删除。`)){
    state=await api('project/remove',{id});
    if((p.sessions||[]).some(s=>s.id===selectedSession)){
     selectedSession='';
     selectedPartition='';
     resetChat();
     resetWorkspaceTabs();
    }
    open.delete(id);
    notice('已移除项目');
   }
   render();
  }
  if(action==='select'){
   showConversation();
   selectedSession=b.dataset.session;
   selectedPartition=id;
   page='workspace';
   resetChat();
   watchSessionEvents(selectedSession);
   try{
    await Promise.all([
     loadChatHistory(api,selectedSession,workerChatId()),
     loadGroupHistory(api,selectedSession),
    ]);
   }catch(err){notice(err.message);}
   render();
  }
  if(action==='chat-mode'){
   chat.modeMenuOpen=!chat.modeMenuOpen;
   patchCompose();
   return;
  }
  if(action==='chat-mode-set'){
   if(!selectedSession)return;
   chat.modeMenuOpen=false;
   await setChatMode(api,selectedSession,workerChatId(),b.dataset.mode);
   patchCompose();
   return;
  }
  if(action==='chat-effort'){
   chat.effort=b.dataset.effort||'';
   patchCompose();
   return;
  }
  if(action==='chat-abort'){
   const scope=b.dataset.scope || (inGroupChat(selectedSession)?'group':'target');
   await abortChat(api,selectedSession,workerChatId(),{scope});
  }
  if(action==='chat-hitl'){
   const card=b.closest('[data-hitl-id]');
   if(card)await resolveHitl(api,card.dataset.hitlId,b.dataset.ok==='1');
  }
  if(action==='pick-manager'){
   if(e.target.closest('.manager-card-fields')) return;
   const card=b.closest('[data-manager-card]')||b;
   await saveManager(payloadFromManagerCard(card));
  }
  if(action==='save-manager'){
   const container=b.closest('#manager-picker, [data-manager-fields]');
   if(!container)return;
   const connectionId=container.querySelector('[name=managerConnectionId]:checked')?.value;
   const model=String(container.querySelector('[name=managerModel]')?.value||'').trim();
   const conn=findConnection(connectionId);
   const group=connectionGroups(conn||{})[0]||managerSeriesId({manager:{connectionId}});
   const last=group?state.managerSelections?.[group]:null;
   const same=state.manager?.connectionId===connectionId;
   const source=same?{...state.manager, model:model||state.manager.model}:(last?{connectionId, ...last, ...(model?{model}:{})}:{connectionId, model});
   const view=managerSelectionView(conn, group, source);
   await saveManager({
    connectionId,
    model:view.model||model,
    effort:view.effort,
    contextWindow:view.contextWindow,
   });
  }
  if(action==='login'){
   const authWindow=openAuthWindow();
   try{
    notice('正在准备官方登录…');
    const result=await api('auth/start',{id});
    const launch=result.authorizationUrl||result.verificationUriComplete||result.verificationUri;
    if(launch && (result.flow==='browser' || result.flow==='device')){
     if(authWindow){
      try{authWindow.location.replace(launch);}catch{ /* 对话框里仍有授权链接 */ }
     }
     if(result.pasteCode){
      notice('请在当前浏览器完成 Google 授权，再把一次性代码粘贴回工作台。');
      dialog(`<h2>粘贴授权码</h2><p class="muted">请在当前 Chrome 完成 Google 账号授权。antigravity.google 页面出现一次性代码后，复制并粘贴到下方。</p><p><a class="primary dialog-link" href="${esc(launch)}" target="_blank" rel="noopener noreferrer">打开授权页面</a></p><label>授权码<input name="code" required autofocus autocomplete="off" placeholder="4/0A..."></label>`,async values=>{
       const done=await api('auth/complete',{id,code:values.code,state:result.state,transactionId:result.transactionId});
       notice(done.email?`已登录 ${done.email}`:'官方账号登录成功');
      });
     }else if(result.flow==='device'){
      notice(result.userCode?`请在当前浏览器完成 xAI 授权，验证码 ${result.userCode}`:'请在当前浏览器完成 xAI 授权。');
      dialog(`<h2>Grok 官方登录</h2><p class="muted">请在当前 Chrome 完成 xAI 账号授权。</p>${result.userCode?`<p>验证码 <strong>${esc(result.userCode)}</strong></p>`:''}<p><a class="primary dialog-link" href="${esc(launch)}" target="_blank" rel="noopener noreferrer">打开授权页面</a></p>`,async()=>{});
     }else if(id==='official-claude'){
      notice('请在当前浏览器完成 Anthropic 授权。');
      dialog(`<h2>Claude 官方登录</h2><p class="muted">请在当前 Chrome 完成 Anthropic 账号授权。</p><p><a class="primary dialog-link" href="${esc(launch)}" target="_blank" rel="noopener noreferrer">打开授权页面</a></p>`,async()=>{});
     }else if(id==='official-codex'){
      notice('请在当前浏览器完成 OpenAI 授权。');
      dialog(`<h2>Codex 官方登录</h2><p class="muted">请在当前 Chrome 完成 OpenAI 账号授权。</p><p><a class="primary dialog-link" href="${esc(launch)}" target="_blank" rel="noopener noreferrer">打开授权页面</a></p>`,async()=>{});
     }else{
      notice(authWindow?'授权页面已在当前浏览器打开，请完成授权。':'请点击按钮在当前浏览器打开授权页面。');
      dialog(`<h2>打开官方授权</h2><p class="muted">请在当前浏览器完成授权。若未自动打开，请点击下方按钮。</p><a class="primary dialog-link" href="${esc(launch)}" target="_blank" rel="noopener noreferrer">打开授权页面</a>`,async()=>{});
     }
    }else{
     try{authWindow?.close();}catch{}
     notice(result.userCode?`请在当前浏览器输入验证码：${result.userCode}`:'请在当前浏览器完成官方登录');
     if(result.userCode)dialog(`<h2>官方登录验证码</h2><p>${esc(result.userCode)}</p><p class="muted">请在当前浏览器完成授权。</p>`,async()=>{});
    }
    watchLogin(id,result);
   }catch(error){
    try{authWindow?.close();}catch{}
    throw error;
   }
  }
  if(action==='disconnect'){
   if(!confirm('退出后将删除工作台中保存的登录凭证。'))return;
   await api('auth/disconnect',{id});
   stopLoginWatch(id);
   await refresh();
   notice('已退出登录');
  }
 }catch(e){
  notice(e.message);
 }finally{
  b.disabled=false;
 }
});

refresh().catch(e=>notice('加载失败：'+e.message));

document.addEventListener('submit',async e=>{
 const chatForm=e.target.closest('[data-chat-form]');
 if(chatForm){
  e.preventDefault();
  const text=String(new FormData(chatForm).get('text')||'').trim();
  if(!text||!selectedSession)return;
  chat.draft='';
  try{await sendChat(api,{sessionId:selectedSession,partitionId:workerChatId(),text});}
  catch(err){notice(err.message);}
  if(partitionsDirty){partitionsDirty=false;render();}
  return;
 }
 const qForm=e.target.closest('[data-question-form]');
 if(qForm){
  e.preventDefault();
  const answers={};
  for(const input of qForm.querySelectorAll('input:checked')){
   const key=input.name;
   answers[key]=answers[key]?[].concat(answers[key],input.value):input.value;
  }
  try{await resolveHitl(api,qForm.dataset.id,true,answers);}
  catch(err){notice(err.message);}
  return;
 }
 const picker=e.target.closest('[data-picker-form]');
 if(picker){
  e.preventDefault();
  const filePath=String(new FormData(picker).get('path')||'').trim();
  if(!filePath||!selectedSession)return;
  try{
   const preview=await api('workspace/file',{sessionId:selectedSession,path:filePath});
   if(preview.kind==='directory'){
    filePickerOpen=true;
    await loadFilePicker(filePath);
    render();
   }else{
    await openFileTab(preview.relative||filePath);
   }
  }catch(err){notice(err.message);}
 }
});

document.addEventListener('keydown',e=>{
 if(e.key==='Escape' && (projectMenu || sessionMenu || summaryOpen || filePickerOpen || chat.modeMenuOpen)){
  projectMenu='';
  chat.modeMenuOpen=false;
  closeWorkspacePopovers();
  render();
  return;
 }
 if(page==='workspace'&&(e.ctrlKey||e.metaKey)&&(e.key==='`'||e.code==='Backquote')){
  e.preventDefault();
  terminalOpen=!terminalOpen;
  render();
  return;
 }
 const area=e.target.closest('[data-chat-form] textarea');
 if(!area)return;
 if(e.key==='Enter'&&!e.shiftKey){
  e.preventDefault();
  area.form?.requestSubmit();
 }
});

document.addEventListener('input',e=>{
 if(e.target.closest('[data-group-form] textarea')) { group.draft=e.target.value; fitCompose(e.target); return; }
 if(e.target.closest('[data-chat-form] textarea')) { chat.draft=e.target.value; fitCompose(e.target); }
});

document.addEventListener('click',e=>{
 const summary=e.target.closest('summary[data-session]');
 if(!summary)return;
 if(e.target.closest('[data-action]'))return;
 const id=summary.dataset.session;
 e.preventDefault();
 const details=summary.closest('details.session-item');
 if(inGroupChat(id)){
  const next=details? !details.open : !open.has(id);
  setSessionListOpen(id, next, details);
  return;
 }
 resetWorkspaceTabs();
 selectedSession=id;
 selectedPartition='';
 setSessionListOpen(id, true, details);
 page='workspace';
 resetChat();
 resetGroup();
 watchSessionEvents(id);
 loadGroupHistory(api,id).catch(err=>notice(err.message)).finally(()=>render());
 return;
}, true);

document.addEventListener('change',async e=>{
 const card=e.target.closest('[data-manager-card]');
 if(card){
  if(!['managerModel','managerEffort','managerContext'].includes(e.target.name)) return;
  try{
   if(e.target.name==='managerModel') applyCardModelDefaults(card);
   await saveManager(payloadFromManagerCard(card));
  }catch(err){
   notice('切换失败：'+err.message);
  }
  return;
 }
 const container=e.target.closest('#manager-picker');
 if(!container)return;
 if(e.target.name!=='managerConnectionId'&&e.target.name!=='managerModel') return;
 const connectionId=container.querySelector('[name=managerConnectionId]:checked')?.value;
 const typed=String(container.querySelector('[name=managerModel]')?.value||'').trim();
 const conn=findConnection(connectionId);
 const group=connectionGroups(conn||{})[0]||'';
 const last=group?state.managerSelections?.[group]:null;
 const same=state.manager?.connectionId===connectionId;
 const model=e.target.name==='managerConnectionId'
  ?(same&&state.manager.model?state.manager.model:(last?.model||preferredConnectionModel(conn, group)))
  :typed;
 if(!connectionId||!model) return;
 const source=same
  ? {...state.manager, model}
  : {connectionId, model, ...(last&&last.model===model?last:{})};
 const view=managerSelectionView(conn, group, source);
 try{
  await saveManager({
   connectionId,
   model:view.model||model,
   effort:view.effort,
   contextWindow:view.contextWindow,
  }, {render:false});
  const label=document.querySelector('.manager-trigger-copy small');
  if(label) label.textContent=managerActorLabel(state)||'选择管理模型';
  const current=container.querySelector('.current-manager span:nth-of-type(2)');
  if(current&&state.manager?.model) current.textContent='当前：'+managerActorLabel(state);
  const section=container.querySelector('[data-manager-fields]');
  if(section) section.outerHTML=managerForm(state);
 }catch(err){
  notice('切换失败：'+err.message);
 }
});
