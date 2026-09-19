import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cpaOAuthSpec,createCpaOAuthHost,bindOAuthCallbackServer} from './cpa-oauth.mjs';
import {OAuthError,OAuthManager,createHttpOAuthHost} from './oauth-manager.mjs';
import {
  emailFromIdToken,
  enrichGeminiOAuthToken,
} from './antigravity-credential.mjs';
import {authAction,official,openHttpsInBrowser,parsePastedAuthCode} from './auth.mjs';

function fakeJwt(payload){
 return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

test('Gemini 官方连接使用 Antigravity 同款粘贴授权码流程',()=>{
 const spec=cpaOAuthSpec('official-gemini',{});
 assert.equal(spec.authorizationEndpoint,'https://accounts.google.com/o/oauth2/auth');
 assert.equal(spec.tokenEndpoint,'https://oauth2.googleapis.com/token');
 assert.equal(spec.redirectUri,'https://antigravity.google/oauth-callback');
 assert.equal(spec.callbackPort,0);
 assert.equal(spec.includeStateInTokenRequest,false);
 assert.equal(spec.extraAuthorizationParams.access_type,'offline');
 assert.equal(spec.extraAuthorizationParams.prompt,'consent');
 assert.match(spec.extraAuthorizationParams.scope,/cloud-platform/);
 assert.match(spec.extraAuthorizationParams.scope,/aicode/);
 assert.match(spec.extraAuthorizationParams.scope,/\bopenid\b/);
 assert.ok(cpaOAuthSpec('official-codex',{}));
 const gemini=official.find(item=>item.id==='official-gemini');
 assert.equal(gemini.authLabel,'Google 账号');
 assert.equal(gemini.description,'浏览器完成 Google 授权后，把 antigravity.google 页面上的一次性代码粘贴回工作台。');
 assert.doesNotMatch(gemini.description,/CLI|无需安装/);
 const authSource=fs.readFileSync(new URL('./auth.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(authSource,/openAntigravityCliLogin|agy\.exe|openAntigravityDesktop/);
 assert.match(authSource,/pasteCode:spec.flow==='browser'&&!spec.callbackPort/);
 assert.match(authSource,/url\.dll,FileProtocolHandler/);
 const appSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(appSource,/about:blank/);
 assert.doesNotMatch(appSource,/resultOfWindowOpen/);
 assert.match(appSource,/window\.open\('','skerry-oauth'\)/);
 assert.match(appSource,/一次性代码后，复制并粘贴到下方/);
 assert.doesNotMatch(appSource,/不启动 Antigravity CLI|无需安装 Antigravity CLI/);
 const startSource=fs.readFileSync(new URL('../scripts/start.mjs',import.meta.url),'utf8');
 assert.match(startSource,/taskkill/);
 assert.doesNotMatch(startSource,/复用现有服务/);
});

test('浏览器开发阶段不调系统浏览器，仅桌面端使用 rundll32',()=>{
 const calls=[];
 const spawnImpl=(cmd,args,opts)=>{calls.push({cmd,args,opts});return {unref(){}};};
 const url='https://accounts.google.com/o/oauth2/auth?client=1&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback';
 assert.deepEqual(openHttpsInBrowser(url,{spawnImpl,env:{NODE_TEST_CONTEXT:'1'}}),{opened:false,reason:'test'});
 assert.deepEqual(openHttpsInBrowser(url,{spawnImpl,env:{}}),{opened:false,reason:'browser'});
 assert.equal(calls.length,0);
 const opened=openHttpsInBrowser(url,{spawnImpl,platform:'win32',env:{AGENTS_DESKTOP:'1'}});
 assert.equal(opened.opened,true);
 assert.equal(calls[0].cmd,'rundll32');
 assert.equal(calls[0].args[0],'url.dll,FileProtocolHandler');
 assert.match(calls[0].args[1],/^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/);
 assert.throws(()=>openHttpsInBrowser('http://127.0.0.1/oauth',{spawnImpl,env:{AGENTS_DESKTOP:'1'}}),/登录地址无效/);
});

test('Gemini 登录启动返回浏览器粘贴码流程，而不是 CLI',async()=>{
 const start=await authAction('start',{id:'official-gemini'});
 assert.equal(start.flow,'browser');
 assert.equal(start.pasteCode,true);
 assert.match(start.authorizationUrl,/^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/);
 assert.match(start.authorizationUrl,/antigravity\.google/);
 assert.equal(JSON.stringify(start).includes('"cli"'),false);
});

test('未配置 Google 客户端时登录按钮灰掉并写明原因',async()=>{
 const {renderOfficialCard}=await import('../public/provider-card.js');
 const html=renderOfficialCard({
  id:'official-gemini',
  name:'Gemini',
  connected:false,
  loginAvailable:false,
  loginDisabledReason:'未配置 GEMINI_OAUTH_CLIENT_ID，官方 Google 登录暂不可用。可改用自定义 Gemini 兼容接口。',
 },'gemini',false);
 assert.match(html,/disabled/);
 assert.match(html,/未配置 Google 客户端/);
});

test('Gemini 授权 URL 与 Antigravity CLI 使用同一回调和 PKCE',async()=>{
 const spec=cpaOAuthSpec('official-gemini',{});
 const host=createCpaOAuthHost('official-gemini',{});
 const url=await host.createAuthorizationUrl({
  state:'state-value',
  codeVerifier:'verifier-value-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  redirectUri:spec.redirectUri,
 });
 const parsed=new URL(url);
 assert.equal(parsed.origin+parsed.pathname,'https://accounts.google.com/o/oauth2/auth');
 assert.equal(parsed.searchParams.get('client_id'),spec.clientId);
 assert.equal(parsed.searchParams.get('redirect_uri'),'https://antigravity.google/oauth-callback');
 assert.equal(parsed.searchParams.get('access_type'),'offline');
 assert.equal(parsed.searchParams.get('prompt'),'consent');
 assert.equal(parsed.searchParams.get('code_challenge_method'),'S256');
 assert.ok(parsed.searchParams.get('code_challenge'));
 assert.match(parsed.searchParams.get('scope'),/aicode/);
 await assert.rejects(
  ()=>host.createAuthorizationUrl({state:'x',codeVerifier:'y',redirectUri:'http://localhost:51121/oauth-callback'}),
  /redirectUri is not allowed/
 );
});

test('粘贴授权码可从页面文案或回调地址中取出 code',()=>{
 assert.equal(parsePastedAuthCode('  4/0A-synthetic-test-code  '),'4/0A-synthetic-test-code');
 assert.equal(parsePastedAuthCode('https://antigravity.google/oauth-callback?state=abc&code=4%2F0A-from-url'),'4/0A-from-url');
 assert.equal(parsePastedAuthCode('授权码: 4/0A-labeled'),'4/0A-labeled');
 assert.equal(parsePastedAuthCode('"4/0A-quoted"'),'4/0A-quoted');
 assert.equal(parsePastedAuthCode(''),'');
});

test('通用 OAuth 回调监听器使用动态端口并转交授权码与 state',async()=>{
 let callback;
 const listener=await bindOAuthCallbackServer({port:0,path:'/auth/callback',onCallback:args=>{callback=args;return true;}});
 try{
  assert.ok(listener.port>0);
  const response=await fetch(`http://127.0.0.1:${listener.port}/auth/callback?code=code-value&state=state-value`);
  assert.equal(response.status,200);
  assert.equal(callback.code,'code-value');
  assert.equal(callback.state,'state-value');
 }finally{listener.close();}
});

test('通用授权码换取保留 PKCE verifier，Google token 请求不发送 state',async()=>{
 let tokenBody;
 const host=createHttpOAuthHost({
  authorizationEndpoint:'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint:'https://oauth2.googleapis.com/token',
  clientId:'client-id',
  clientSecret:'client-secret',
  includeStateInTokenRequest:false,
  fetchImpl:async(_url,init)=>{
   tokenBody=Object.fromEntries(new URLSearchParams(init.body));
   return {ok:true,json:async()=>({access_token:'test-token',expires_in:3600})};
  },
 });
 await host.exchangeCode({code:'auth-code',codeVerifier:'pkce-verifier',redirectUri:'http://127.0.0.1:32123/auth/callback',state:'browser-state'});
 assert.equal(tokenBody.code,'auth-code');
 assert.equal(tokenBody.code_verifier,'pkce-verifier');
 assert.equal(tokenBody.state,undefined);
});

test('id_token 可解析邮箱',()=>{
 const idToken=fakeJwt({email:'user@example.com'});
 assert.equal(emailFromIdToken(idToken),'user@example.com');
});

test('官方登录退出会删除工作台凭证',()=>{
 const authSource=fs.readFileSync(new URL('./auth.mjs',import.meta.url),'utf8');
 assert.match(authSource,/manager\.disconnect\(b\.id\)/);
 assert.doesNotMatch(authSource,/官方登录不可删除，请在对应官方客户端中管理账号/);
});

test('工作台不读写别家 Gemini/Antigravity 凭据',()=>{
 const authSource=fs.readFileSync(new URL('./auth.mjs',import.meta.url),'utf8');
 const credSource=fs.readFileSync(new URL('./antigravity-credential.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(authSource,/persistAntigravityCliCredential|loadAntigravity|GEMINI_OAUTH_CREDS_DIR|本机已有 Google 授权|spawn\('grok'|cliAuthFiles/);
 assert.doesNotMatch(credSource,/oauth_creds\.json|google_accounts\.json|CredRead|CredWrite|gemini:antigravity/);
 assert.match(authSource,/saveSecret\(id,JSON\.stringify\(token\)\)/);
});

test('授权码换取失败时仅返回安全诊断，不泄漏服务端原始错误', async () => {
 const manager = new OAuthManager({hosts:{provider:{
  flow:'browser',
  createAuthorizationUrl:async()=> 'https://example.com/auth',
  exchangeCode:async()=> { throw new OAuthError('invalid_grant','sensitive provider response must not reach UI'); },
 }}});
 const start = await manager.start('provider',{redirectUri:'http://127.0.0.1:32123/auth/callback'});
 await assert.rejects(()=>manager.callback('provider',{code:'authorization-code',state:start.state}), /sensitive provider response/);
 const transaction = manager.status('provider').transaction;
 assert.equal(transaction.status,'error');
 assert.deepEqual(transaction.error,{code:'invalid_grant',message:'授权码已失效、已被使用，或回调地址不匹配；请重新发起登录。'});
 assert.equal(JSON.stringify(transaction).includes('sensitive provider response'),false);
});

test('Gemini 换票使用托管回调和 PKCE，并从 id_token 解析邮箱',async()=>{
 let tokenUrl;
 let tokenBody;
 let userinfoCalled=false;
 const idToken=fakeJwt({email:'paste-user@example.com'});
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async(url,init)=>{
   if(String(url).includes('userinfo')){userinfoCalled=true;throw new Error('id_token already has email');}
   tokenUrl=String(url);
   tokenBody=Object.fromEntries(new URLSearchParams(init.body));
   return {ok:true,json:async()=>({
    access_token:'ya29.test-access',
    refresh_token:'1//test-refresh',
    token_type:'Bearer',
    expires_in:3600,
    scope:'openid email',
    id_token:idToken,
   })};
  },
 });
 const token=await host.exchangeCode({
  code:'4/0A-synthetic-code',
  codeVerifier:'pkce-verifier',
  redirectUri:'https://antigravity.google/oauth-callback',
  state:'browser-state',
 });
 assert.equal(tokenUrl,'https://oauth2.googleapis.com/token');
 assert.equal(tokenBody.code,'4/0A-synthetic-code');
 assert.equal(tokenBody.code_verifier,'pkce-verifier');
 assert.equal(tokenBody.redirect_uri,'https://antigravity.google/oauth-callback');
 assert.equal(tokenBody.grant_type,'authorization_code');
 assert.equal(tokenBody.state,undefined);
 assert.equal(token.email,'paste-user@example.com');
 assert.equal(token.id_token,idToken);
 assert.equal(typeof token.expiry_date,'number');
 assert.equal(userinfoCalled,false);
});

test('没有 id_token 时用 userinfo 补邮箱',async()=>{
 const token=await enrichGeminiOAuthToken(
  {access_token:'ya29.test-access',refresh_token:'1//test-refresh',token_type:'Bearer',expires_in:60},
  {fetchImpl:async(url)=>{
   assert.match(String(url),/oauth2\/v2\/userinfo/);
   return {ok:true,json:async()=>({email:'userinfo@example.com'})};
  }},
 );
 assert.equal(token.email,'userinfo@example.com');
 assert.equal(token.access_token,'ya29.test-access');
});

test('Gemini 刷新按 Antigravity 方式换 AT，Google 不返回 RT 时保留旧 RT',async()=>{
 const spec=cpaOAuthSpec('official-gemini',{});
 let tokenBody;
 let userinfoCalled=false;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async(url,init)=>{
   if(String(url).includes('userinfo')){userinfoCalled=true;throw new Error('refresh must not call userinfo');}
   tokenBody=Object.fromEntries(new URLSearchParams(init.body));
   assert.equal(String(url),'https://oauth2.googleapis.com/token');
   return {ok:true,json:async()=>({access_token:'ya29.new-access',token_type:'Bearer',expires_in:3600})};
  },
 });
 let saved;
 const now=1_700_000_000_000;
 const manager=new OAuthManager({
  hosts:{'official-gemini':host},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>({accessToken:'ya29.old-access',refreshToken:'1//keep-rt',expiresAt:now+60_000,email:'keep@example.com'}),
  saveToken:(_id,token)=>{saved=token;},
 });
 const token=await manager.accessTokenForRuntime('official-gemini');
 assert.equal(token,'ya29.new-access');
 assert.equal(tokenBody.grant_type,'refresh_token');
 assert.equal(tokenBody.refresh_token,'1//keep-rt');
 assert.equal(tokenBody.client_id,spec.clientId);
 assert.equal(tokenBody.client_secret,spec.clientSecret);
 assert.equal(tokenBody.state,undefined);
 assert.equal(saved.accessToken,'ya29.new-access');
 assert.equal(saved.refreshToken,'1//keep-rt');
 assert.equal(saved.expiresAt,now+3600_000);
 assert.equal(saved.email,'keep@example.com');
 assert.equal(userinfoCalled,false);
});

test('Gemini 刷新若 Google 返回新 RT 则轮换，并合并并发刷新',async()=>{
 let calls=0;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async()=>{
   calls+=1;
   await new Promise(resolve=>setTimeout(resolve,40));
   return {ok:true,json:async()=>({
    access_token:'ya29.rotated-access',
    refresh_token:'1//new-rt',
    token_type:'Bearer',
    expires_in:1800,
   })};
  },
 });
 const saved=[];
 const now=1_700_000_000_000;
 const manager=new OAuthManager({
  hosts:{'official-gemini':host},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>({accessToken:'ya29.old-access',refreshToken:'1//old-rt',expiresAt:now+30_000}),
  saveToken:(_id,token)=>{saved.push(token);},
 });
 const [first,second]=await Promise.all([
  manager.accessTokenForRuntime('official-gemini'),
  manager.accessTokenForRuntime('official-gemini'),
 ]);
 assert.equal(first,'ya29.rotated-access');
 assert.equal(second,'ya29.rotated-access');
 assert.equal(calls,1);
 assert.equal(saved.at(-1).refreshToken,'1//new-rt');
});

test('Gemini 访问令牌在 5 分钟安全窗口外不刷新',async()=>{
 let calls=0;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async()=>{calls+=1;throw new Error('must not refresh');},
 });
 const now=1_700_000_000_000;
 const manager=new OAuthManager({
  hosts:{'official-gemini':host},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>({accessToken:'ya29.still-valid',refreshToken:'1//rt',expiresAt:now+6*60*1000}),
 });
 assert.equal(await manager.accessTokenForRuntime('official-gemini'),'ya29.still-valid');
 assert.equal(calls,0);
});

test('Gemini 刷新返回空 RT 时保留旧 RT',async()=>{
 let saved;
 const now=1_700_000_000_000;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async()=>({ok:true,json:async()=>({access_token:'ya29.new-access',refresh_token:'',token_type:'Bearer',expires_in:3600})}),
 });
 const manager=new OAuthManager({
  hosts:{'official-gemini':host},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>({accessToken:'ya29.old-access',refreshToken:'1//keep-rt',expiresAt:now+60_000,email:'keep@example.com'}),
  saveToken:(_id,token)=>{saved=token;},
 });
 assert.equal(await manager.accessTokenForRuntime('official-gemini'),'ya29.new-access');
 assert.equal(saved.refreshToken,'1//keep-rt');
 assert.equal(saved.email,'keep@example.com');
});

test('Gemini 刷新 invalid_grant 时公开状态改为需重新登录，不删凭证、不泄露服务端原文',async()=>{
 let saved={accessToken:'ya29.old-access',refreshToken:'1//keep-rt',expiresAt:1_700_000_000_000+60_000,email:'keep@example.com'};
 let recover=false;
 const now=1_700_000_000_000;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async()=>{
   if(!recover)return {ok:false,status:400,json:async()=>({error:'invalid_grant',error_description:'Token has been expired or revoked'})};
   return {ok:true,json:async()=>({access_token:'ya29.recovered',refresh_token:'1//new-rt',token_type:'Bearer',expires_in:3600})};
  },
 });
 const manager=new OAuthManager({
  hosts:{'official-gemini':host},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>saved,
  saveToken:(_id,token)=>{saved=token;},
 });
 await assert.rejects(
  ()=>manager.accessTokenForRuntime('official-gemini'),
  err=>err instanceof OAuthError && err.code==='invalid_grant',
 );
 const status=manager.status('official-gemini');
 assert.equal(status.connected,true);
 assert.equal(status.expired,true);
 assert.equal(status.authError.code,'invalid_grant');
 assert.equal(status.authError.message,'授权已失效，请重新登录。');
 assert.equal(JSON.stringify(status).includes('revoked'),false);
 assert.equal(JSON.stringify(status).includes('ya29.old-access'),false);
 assert.equal(saved.refreshToken,'1//keep-rt');
 recover=true;
 assert.equal(await manager.accessTokenForRuntime('official-gemini'),'ya29.recovered');
 assert.equal(manager.status('official-gemini').authError,undefined);
 assert.equal(manager.status('official-gemini').expired,false);
 assert.equal(saved.refreshToken,'1//new-rt');
});

test('Gemini 刷新网络失败时保持已连接，不展示授权失效',async()=>{
 const now=1_700_000_000_000;
 const manager=new OAuthManager({
  hosts:{'official-gemini':createCpaOAuthHost('official-gemini',{},{fetchImpl:async()=>{throw new Error('network down');}})},
  refreshLeewayMs:5*60*1000,
  now:()=>now,
  loadToken:()=>({accessToken:'ya29.old-access',refreshToken:'1//keep-rt',expiresAt:now+60_000,email:'keep@example.com'}),
  saveToken:()=>{throw new Error('must not persist on network failure');},
 });
 await assert.rejects(()=>manager.accessTokenForRuntime('official-gemini'),err=>err instanceof OAuthError && err.code==='oauth_refresh_failed');
 const status=manager.status('official-gemini');
 assert.equal(status.connected,true);
 assert.equal(status.expired,false);
 assert.equal(status.authError,undefined);
});

test('粘贴授权码完成登录后只把公开状态交给 UI',async()=>{
 let saved;
 const host=createCpaOAuthHost('official-gemini',{},{
  fetchImpl:async(url)=>{
   if(String(url).includes('userinfo'))return {ok:true,json:async()=>({email:'ui@example.com'})};
   return {ok:true,json:async()=>({
    access_token:'ya29.ui-access',
    refresh_token:'1//ui-refresh',
    token_type:'Bearer',
    expires_in:3600,
   })};
  },
 });
 const manager=new OAuthManager({hosts:{'official-gemini':host},saveToken:(_id,token)=>{saved=token;}});
 const start=await manager.start('official-gemini',{redirectUri:'https://antigravity.google/oauth-callback'});
 const result=await manager.callback('official-gemini',{code:parsePastedAuthCode('  4/0A-ui-code  '),state:start.state});
 assert.equal(result.status,'connected');
 assert.equal(JSON.stringify(result).includes('ya29.ui-access'),false);
 assert.equal(saved.accessToken,'ya29.ui-access');
 assert.equal(saved.email,'ui@example.com');
 assert.equal(saved.refreshToken,'1//ui-refresh');
});

