import { OAuthManager } from './oauth-manager.mjs';
import { installCpaOAuthHosts, cpaOAuthSpec, bindOAuthCallbackServer } from './cpa-oauth.mjs';
import { loadSecret, saveSecret, deleteSecret } from './secret-store.mjs';
import { spawn } from 'node:child_process';
import { emailFromIdToken } from './antigravity-credential.mjs';

const hosts=installCpaOAuthHosts({});
export const official=[
 {id:'official-grok',name:'Grok',loginAvailable:true,authLabel:'xAI 账号',description:'浏览器完成 xAI 授权后，工作台保存凭证。'},
 {id:'official-claude',name:'Claude',loginAvailable:true,authLabel:'Anthropic 账号',description:'浏览器完成 Anthropic 授权后，工作台保存凭证。'},
 {id:'official-codex',name:'Codex',loginAvailable:true,authLabel:'OpenAI 账号',description:'浏览器完成 OpenAI 授权后，工作台保存凭证。'},
 {id:'official-gemini',name:'Gemini',loginAvailable:false,authLabel:'Google 账号',description:'浏览器完成 Google 授权后，把 antigravity.google 页面上的一次性代码粘贴回工作台。'},
];

function loadOfficialToken(id){try{const value=loadSecret(id);if(value)return JSON.parse(value)}catch{}return null;}
function accountEmail(token){return token?.email||emailFromIdToken(token?.id_token??token?.idToken)||null;}
function saveOfficialToken(id,token){
 saveSecret(id,JSON.stringify(token));
}
function deleteOfficialToken(id){deleteSecret(id);}
const GEMINI_REFRESH_LEEWAY_MS=5*60*1000;
const manager=new OAuthManager({hosts,loadToken:loadOfficialToken,saveToken:saveOfficialToken,deleteToken:deleteOfficialToken,refreshLeewayMs:GEMINI_REFRESH_LEEWAY_MS});
const callbacks=new Map();

/** Desktop-only OS browser open. Browser-dev uses the same Chrome tab via the frontend. */
export function openHttpsInBrowser(url,{spawnImpl=spawn,platform=process.platform,env=process.env}={}){
 if(env.NODE_TEST_CONTEXT)return {opened:false,reason:'test'};
 if(env.AGENTS_DESKTOP!=='1')return {opened:false,reason:'browser'};
 const parsed=new URL(url);
 if(parsed.protocol!=='https:')throw new Error('登录地址无效');
 const href=parsed.href;
 const child=platform==='win32'
  ?spawnImpl('rundll32',['url.dll,FileProtocolHandler',href],{detached:true,stdio:'ignore',windowsHide:true})
  :platform==='darwin'
   ?spawnImpl('open',[href],{detached:true,stdio:'ignore'})
   :spawnImpl('xdg-open',[href],{detached:true,stdio:'ignore'});
 child?.unref?.();
 return {opened:true};
}
function geminiStatus(){
 const oauth=manager.status('official-gemini');
 const stored=loadOfficialToken('official-gemini');
 if(oauth.connected)return {...oauth,credentialSource:'工作台 Google 授权',email:accountEmail(stored)};
 return oauth;
}
function grokStatus(){
 const oauth=manager.status('official-grok');
 const stored=loadOfficialToken('official-grok');
 if(oauth.connected)return {...oauth,credentialSource:'工作台 xAI 授权',email:accountEmail(stored),flow:'device'};
 return {...oauth,flow:'device'};
}
function claudeStatus(){
 const oauth=manager.status('official-claude');
 const stored=loadOfficialToken('official-claude');
 if(oauth.connected)return {...oauth,credentialSource:'工作台 Anthropic 授权',email:accountEmail(stored)||stored?.account?.email_address||null};
 return oauth;
}
function codexStatus(){
 const oauth=manager.status('official-codex');
 const stored=loadOfficialToken('official-codex');
 if(oauth.connected)return {...oauth,credentialSource:'工作台 OpenAI 授权',email:accountEmail(stored)};
 return oauth;
}

function geminiLoginReady(env=process.env){
 const spec=cpaOAuthSpec('official-gemini', env);
 return Boolean(String(spec?.clientId||'').trim());
}

export const statuses=()=>official.map(c=>{
 if(c.id==='official-gemini'){
  const ready=geminiLoginReady();
  return {
    ...c,
    kind:'official',
    models:[],
    ...geminiStatus(),
    flow:'browser',
    loginAvailable:ready,
    loginDisabledReason: ready ? undefined : '未配置 GEMINI_OAUTH_CLIENT_ID，官方 Google 登录暂不可用。可改用自定义 Gemini 兼容接口。',
    description: ready
      ? c.description
      : '未配置 GEMINI_OAUTH_CLIENT_ID。官方 Google 登录已停用，可用自定义供应商接入 Gemini 兼容接口。',
  };
 }
 if(c.id==='official-grok')return {...c,kind:'official',models:[],...grokStatus()};
 if(c.id==='official-claude')return {...c,kind:'official',models:[],...claudeStatus(),flow:'browser'};
 if(c.id==='official-codex')return {...c,kind:'official',models:[],...codexStatus(),flow:'browser'};
 return {...c,kind:'official',models:[],...manager.status(c.id)};
});

/** Refresh workbench-stored official AT/RT inside the 5-minute safety window. */
export async function refreshOfficialIfNeeded(id){
 const ids=id?[id]:['official-gemini','official-grok','official-claude','official-codex'];
 for(const providerId of ids){
  const status=manager.status(providerId);
  if(!status.connected||!status.refreshable||status.authError)continue;
  try{await manager.accessTokenForRuntime(providerId);}catch{ /* keep stored token; 授权作废时由 status.authError 展示 */ }
 }
}

export function parsePastedAuthCode(raw){
 const text=String(raw||'').replace(/^(?:authorization\s*code|auth\s*code|授权码)\s*[:：]\s*/i,'').trim();
 if(!text)return '';
 try{
  const fromUrl=new URL(text).searchParams.get('code');
  if(fromUrl)return fromUrl.trim();
 }catch{ /* not a URL */ }
 const query=text.match(/[?&#]code=([^&\s]+)/);
 if(query)return decodeURIComponent(query[1]);
 return text.replace(/\s+/g,'').replace(/^['"]|['"]$/g,'');
}

export async function authAction(action,b){
 if(!['start','poll','disconnect','complete'].includes(action))throw new Error('登录操作无效');
 const entry=official.find(c=>c.id===b.id);
 if(!entry)throw new Error('官方登录方式不存在');
 if(action==='disconnect'){
  callbacks.get(b.id)?.close();
  callbacks.delete(b.id);
  manager.disconnect(b.id);
  return {disconnected:true};
 }
 if(action==='poll')return await manager.poll(b.id,b.transactionId);
 if(action==='complete'){
  const code=parsePastedAuthCode(b.code);
  if(!code)throw new Error('请粘贴授权码');
  const state=String(b.state||b.transactionId||'').trim();
  if(!state)throw new Error('登录会话已失效，请重新登录');
  const result=await manager.callback(b.id,{code,state});
  return {...result,email:accountEmail(loadOfficialToken(b.id))};
 }
 const spec=cpaOAuthSpec(b.id);
 if(!spec)throw new Error('官方登录当前不可用');
 if(b.id==='official-gemini' && !String(spec.clientId||'').trim()){
  throw new Error('未配置 GEMINI_OAUTH_CLIENT_ID，官方 Google 登录暂不可用');
 }
 let redirectUri=spec.redirectUri;
 if(callbacks.has(b.id)){callbacks.get(b.id).close();callbacks.delete(b.id);}
 if(spec.flow==='browser' && spec.callbackPort){
  const listener=await bindOAuthCallbackServer({port:spec.callbackPort,path:spec.callbackPath,onCallback:async args=>{await manager.callback(b.id,args);listener.close();callbacks.delete(b.id);return true;}});
  if(!redirectUri)redirectUri=`http://localhost:${listener.port}${spec.callbackPath}`;
  callbacks.set(b.id,listener);setTimeout(()=>{listener.close();if(callbacks.get(b.id)===listener)callbacks.delete(b.id)},600000).unref();
 }
 try{
  const result=await manager.start(b.id,{redirectUri});
  const launch=result.authorizationUrl||result.verificationUriComplete||result.verificationUri;
  if(!launch||new URL(launch).protocol!=='https:')throw new Error('登录地址无效');
  try{openHttpsInBrowser(launch);}catch{ /* 浏览器开发阶段由前端在当前 Chrome 打开授权页 */ }
  return {transactionId:result.transactionId,state:result.state,flow:result.flow,pasteCode:spec.flow==='browser'&&!spec.callbackPort,userCode:result.userCode,interval:result.interval,authorizationUrl:result.authorizationUrl,verificationUri:result.verificationUri,verificationUriComplete:result.verificationUriComplete};
 }catch(e){callbacks.get(b.id)?.close();callbacks.delete(b.id);throw e;}
}

export async function officialAccessToken(id) {
  return manager.accessTokenForRuntime(id);
}

export function officialTokenRecord(id) {
  return loadOfficialToken(id);
}
