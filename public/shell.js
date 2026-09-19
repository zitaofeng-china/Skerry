import {MODEL_GROUPS, connectionsInGroup, connectionGroups} from './model-groups.js';
import {connectionModelChoices, preferredConnectionModel, REASONING_LEVELS, REASONING_LABELS, managerSelectionView} from './model-selection.js';

export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icons={
 logo:'<img class="brand-mark" src="/icons/skerry.svg" alt="" aria-hidden="true">',
 settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z"/><circle cx="11.5" cy="11" r="3"/></svg>',
 ai:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/></svg>',
 edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
 test:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
 copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
 trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>',
 plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
 play:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m8 5 11 7-11 7V5z"/></svg>',
 back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>',
 check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
 eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
 eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>',
 link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
 claude:'<img src="/icons/claude.svg" alt="" aria-hidden="true">',
 codex:'<img src="/icons/openai.svg" alt="" aria-hidden="true">',
 gemini:'<img src="/icons/gemini.svg" alt="" aria-hidden="true">',
 grok:'<img src="/icons/grok.svg" alt="" aria-hidden="true">',
 generic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
 search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
 sort:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 7h12M8 12h8M8 17h4"/><path d="M4 7v10"/></svg>',
 zap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
 star:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6.1L12 16.9 6.7 19.8l1-6.1L3.3 9.4l6-.9L12 3z"/></svg>',
 heart:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-6.5-4.2-9.2-8.1C.8 10.1 1.6 6.2 5 5.1 7.1 4.4 9.2 5.2 12 8c2.8-2.8 4.9-3.6 7-2.9 3.4 1.1 4.2 5 2.2 7.8C18.5 16.8 12 21 12 21z"/></svg>',
 terminal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>',
 panel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
 keyboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>',
 more:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
 pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.2"/></svg>',
 folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
 archive:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zM3 4h18v4H3zM10 12h4"/></svg>',
 close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
};
export function appSwitcher(activeGroup, groups){
 return `<div class="cc-app-switcher" role="tablist" aria-label="模型系列选择">${groups.map(g=>`<button role="tab" class="cc-app-tab ${g.id===activeGroup?'active':''}" data-action="model-group" data-id="${g.id}" aria-selected="${g.id===activeGroup}"><span class="app-tab-icon">${icons[g.id]||icons.ai}</span><span class="app-tab-name">${esc(g.name)}</span></button>`).join('')}</div>`;
}
function managerConnections(state){return [...(state.official||[]),...(state.connections||[]).map(c=>({...c,kind:'custom'}))];}
function connectionReady(c){return c.kind==='official'?c.connected&&!c.expired:c.hasKey;}
function modelLabel(connection, group){
 if(group?.name) return group.name;
 const id=connectionGroups(connection||{})[0];
 return MODEL_GROUPS.find(g=>g.id===id)?.name || connection?.name || '模型';
}
export function activeProviderForGroup(state, groupId){
 if(!groupId)return null;
 const official=connectionsInGroup(state.official||[], groupId).map(c=>({...c,kind:'official'}));
 const custom=connectionsInGroup(state.connections||[], groupId).map(c=>({...c,kind:c.kind||'custom'}));
 const items=[...official,...custom];
 if(!items.length)return null;
 const activeId=state.activeProviders?.[groupId];
 const picked=activeId?items.find(c=>c.id===activeId):null;
 if(picked)return picked;
 return official.find(c=>c.connected&&!c.expired)||custom.find(c=>c.hasKey)||items[0];
}
export function managerSeriesId(state){
 const id=state?.manager?.connectionId;
 if(!id) return '';
 const c=managerConnections(state).find(x=>x.id===id);
 if(c){
  const group=connectionGroups(c)[0];
  if(group) return group;
 }
 const official=MODEL_GROUPS.find(g=>g.officialIds.includes(id));
 return official?.id||'';
}
export function managerActorLabel(state){
 const selected=state?.manager;
 if(!selected?.model) return '';
 const series=MODEL_GROUPS.find(g=>g.id===managerSeriesId(state));
 const effort=selected.effort?REASONING_LABELS[selected.effort]||selected.effort:'';
 return [series?.name, selected.model, effort].filter(Boolean).join(' · ');
}
function extraUngroupedConnections(state, seen){
 const out=[];
 for(const c of managerConnections(state)){
  if(seen.has(c.id)||!connectionReady(c)||connectionGroups(c).length)continue;
  seen.add(c.id);
  out.push(c);
 }
 return out;
}
function managerProviders(state, groupId){
 if(groupId){
  const c=activeProviderForGroup(state, groupId);
  return c?[c]:[];
 }
 const seen=new Set(),out=[];
 for(const g of MODEL_GROUPS){
  const c=activeProviderForGroup(state, g.id);
  if(!c||seen.has(c.id))continue;
  seen.add(c.id);
  out.push(c);
 }
 out.push(...extraUngroupedConnections(state, seen));
 return out;
}
export function managerForm(state, groupId){
 const allAvailable=managerProviders(state).filter(connectionReady);
 const current=state.manager;
 if(!allAvailable.length)return `<div class="manager-empty"><span class="ai-avatar">${icons.ai}</span><h3>先连接一个模型</h3><p>在模型提供商中完成官方登录或保存自定义密钥后，即可选为管理者。</p><button class="primary" data-action="settings-tab" data-id="providers">前往模型提供商</button></div>`;
 const available=managerProviders(state, groupId).filter(connectionReady);
 if(!available.length){
  const group=MODEL_GROUPS.find(g=>g.id===groupId);
  return `<div class="manager-empty"><span class="ai-avatar">${icons.ai}</span><h3>先连接 ${esc(group?.name||'该系列')}</h3><p>为该模型提供商启用官方登录或一个自定义提供商后，即可选为管理者。</p><button class="primary" data-action="settings-tab" data-id="providers">前往模型提供商</button></div>`;
 }
 const currentSeries=managerSeriesId(state);
 const chosen=available.find(c=>c.id===current?.connectionId)
  || available.find(c=>connectionGroups(c)[0]===currentSeries)
  || available[0];
 const extra=current?.connectionId===chosen.id&&current.model?[{id:current.model,label:current.model,group:groupId||''}]:[];
 const seen=new Set();
 const choices=[...connectionModelChoices(chosen, groupId),...extra].filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true;});
 const selected=current?.connectionId===chosen.id&&current.model?current.model:preferredConnectionModel(chosen, groupId);
 const hint=groupId?`<p class="manager-hint">管理者使用当前启用的 ${esc((MODEL_GROUPS.find(g=>g.id===groupId)||{}).name||'该系列')} 模型。</p>`:'';
 return `<div data-manager-fields data-manager-group="${esc(groupId||'')}"><div class="manager-options" role="group" aria-label="管理者 AI 连接">${available.map(c=>{
  const preferred=preferredConnectionModel(c, groupId);
  const n=connectionModelChoices(c, groupId).length;
  const detail=preferred||(n?`${n} 个模型`:'可手动输入');
  const label=modelLabel(c, MODEL_GROUPS.find(g=>g.id===groupId));
  return `<label class="manager-option ${chosen.id===c.id?'chosen':''}"><input type="radio" name="managerConnectionId" value="${esc(c.id)}" ${chosen.id===c.id?'checked':''}><span class="provider-avatar">${esc(label.slice(0,1))}</span><span class="option-copy"><strong>${esc(label)}</strong><small>${esc(detail)}</small></span><span class="option-check">✓</span></label>`;
 }).join('')}</div><label class="manager-model">管理者模型<input name="managerModel" list="manager-models" value="${esc(selected||'')}" placeholder="${choices.length?'从已配置模型中选择或输入':'输入模型标识'}" autocomplete="off" aria-label="管理者模型" data-manager-model><datalist id="manager-models">${choices.map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</datalist></label>${hint}<button type="button" class="primary manager-save" data-action="save-manager">使用此模型</button></div>`;
}
function effortSelectHtml(value, levels){
 const allowed=levels?.length?levels:REASONING_LEVELS;
 return `<select name="managerEffort" aria-label="努力程度"><option value="">未设置</option>${allowed.map(level=>`<option value="${esc(level)}" ${String(value||'')===level?'selected':''}>${esc(REASONING_LABELS[level]||level)} (${esc(level)})</option>`).join('')}</select>`;
}
function modelFieldHtml(choices, selected){
 const list=[...choices];
 if(selected&&!list.some(m=>m.id===selected)) list.unshift({id:selected,label:selected});
 if(!list.length) return `<input name="managerModel" value="${esc(selected||'')}" placeholder="输入模型标识" autocomplete="off" aria-label="型号">`;
 return `<select name="managerModel" aria-label="型号">${list.map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.label)}</option>`).join('')}</select>`;
}
function renderManagerCard(state, group, connection, ready){
 const groupId=group?.id||'';
 const current=state.manager;
 const seriesId=managerSeriesId(state);
 const isCurrent=Boolean(ready&&connection&&(groupId?seriesId===groupId:current?.connectionId===connection.id));
 const title=modelLabel(connection, group);
 const icon=icons[groupId]||icons[String(connection?.id||'').replace(/^official-/,'')]||icons.ai;
 if(!ready){
  return `<article class="cc-provider-card manager-card is-disabled">
    <div class="cc-card-main">
      <div class="cc-card-icon">${icon}</div>
      <div class="cc-card-info">
        <div class="cc-card-header-row">
          <h3 class="cc-card-title">${esc(title)}</h3>
          <span class="cc-badge warning">未就绪</span>
        </div>
        <p class="muted cc-section-empty">尚未连接，请先在模型提供商中完成配置</p>
      </div>
    </div>
  </article>`;
 }
 const last=groupId?state.managerSelections?.[groupId]:null;
 const viewSource=isCurrent
  ? {...current, connectionId:connection.id}
  : (last?{connectionId:connection.id, ...last}:null);
 const view=managerSelectionView(connection, groupId, viewSource);
 const choices=connectionModelChoices(connection, groupId);
 return `<article class="cc-provider-card manager-card ${isCurrent?'is-manager':''}" data-manager-card data-action="pick-manager" data-id="${esc(connection.id)}" data-group="${esc(groupId)}" data-last-model="${esc(view.model||'')}">
  <div class="cc-card-main">
    <div class="cc-card-icon">${icon}</div>
    <div class="cc-card-info">
      <div class="cc-card-header-row">
        <h3 class="cc-card-title">${esc(title)}</h3>
        ${isCurrent?`<span class="cc-badge ready">${icons.check} 当前管理者</span>`:''}
      </div>
    </div>
  </div>
  <div class="manager-card-fields">
    <label>型号${modelFieldHtml(choices, view.model)}</label>
    <label>努力程度${effortSelectHtml(view.effort, view.levels)}</label>
    <label>上下文大小<input name="managerContext" inputmode="numeric" pattern="[0-9]*" value="${esc(view.contextWindow??'')}" autocomplete="off" placeholder="例如 128000" aria-label="上下文大小"></label>
  </div>
 </article>`;
}
export function managerCards(state){
 const seen=new Set();
 const cards=[];
 for(const group of MODEL_GROUPS){
  const connection=activeProviderForGroup(state, group.id);
  if(connection) seen.add(connection.id);
  cards.push(renderManagerCard(state, group, connection, Boolean(connection&&connectionReady(connection))));
 }
 for(const connection of extraUngroupedConnections(state, seen)){
  cards.push(renderManagerCard(state, null, connection, true));
 }
 const ready=cards.some(html=>html.includes('data-manager-card'));
 const empty=ready?'':`<div class="cc-empty-state"><div class="cc-empty-icon">${icons.ai}</div><h3>还没有可做管理者的模型</h3><p class="muted">在模型提供商中完成官方登录或保存自定义密钥后，即可点卡片切换管理者。</p><button class="primary" data-action="settings-tab" data-id="providers">前往模型提供商</button></div>`;
 return `<p class="muted cc-section-note">点卡片即可切换管理者，并设置型号、努力程度和上下文大小。</p>${empty}<div class="cc-provider-list manager-card-list">${cards.join('')}</div>`;
}
function managerTriggerDetail(state){
 const label=managerActorLabel(state);
 return label||'选择管理模型';
}
export function footer(state){
 const selected=state.manager,c=managerConnections(state).find(c=>c.id===selected?.connectionId),ready=c&&(c.kind==='official'?c.connected&&!c.expired:c.hasKey);
 const detail=managerTriggerDetail(state);
 return `<div class="sidebar-footer"><div id="manager-picker" role="dialog" aria-labelledby="manager-picker-title" popover="auto" class="manager-popover"><div class="popover-heading"><div><h2 id="manager-picker-title">管理者 AI</h2></div><button class="icon-button" popovertarget="manager-picker" popovertargetaction="hide" aria-label="关闭管理者选择">×</button></div>${selected?`<div class="current-manager"><span class="status-dot ${ready?'ready':''}"></span><span>当前：${esc(detail)}</span><small>${ready?'已选择':'连接待恢复'}</small></div>`:''}${managerForm(state)}</div><button class="manager-trigger" popovertarget="manager-picker" aria-label="选择管理者 AI" aria-haspopup="dialog"><span class="ai-avatar">${icons.ai}</span><span class="manager-trigger-copy"><strong>管理者 AI</strong><small>${esc(detail)}</small></span><span class="chevrons">⌃</span></button><button class="settings-square" data-action="settings" aria-label="设置" title="设置">${icons.settings}</button></div>`;
}
export const SETTINGS_TABS=[{id:'providers',label:'模型提供商'},{id:'manager',label:'管理者 AI'}];
export const SETTINGS_NAV=[{id:'models',label:'模型选择',icon:'settings'},{id:'shortcuts',label:'快捷键',icon:'keyboard'}];
export function parseSettingsTab(hash=''){
 const part=String(hash).replace(/^#?settings\/?/, '');
 if(part==='manager')return 'manager';
 if(part==='shortcuts')return 'shortcuts';
 return 'providers';
}
export function accountSwitcher(active){
 return `<div class="cc-pill-tabs" role="tablist" aria-label="模型选择分类">${SETTINGS_TABS.map(t=>`<button type="button" role="tab" class="cc-pill-tab ${t.id===active?'active':''}" data-action="settings-tab" data-id="${t.id}" aria-selected="${t.id===active}">${t.label}</button>`).join('')}</div>`;
}
export function settingsShell(content, tab='providers'){
 const section=tab==='shortcuts'?'shortcuts':'models';
 const nav=SETTINGS_NAV.map(item=>{
  const active=item.id===section;
  return `<button class="settings-nav-item ${active?'active':''}" type="button" data-action="settings-section" data-id="${item.id}" ${active?'aria-current="page"':''}>${icons[item.icon]||icons.settings}<span>${item.label}</span></button>`;
 }).join('');
 return `<div class="settings-page"><aside class="settings-nav"><button class="back-button" data-action="workspace">← 返回工作台</button><div class="settings-title">设置</div><nav aria-label="设置分类">${nav}</nav><div class="settings-nav-footer">Skerry</div></aside><main class="settings-main"><header><span>设置</span><button class="icon-button" data-action="workspace" aria-label="关闭设置">×</button></header><div class="content">${content}</div></main></div>`;
}




