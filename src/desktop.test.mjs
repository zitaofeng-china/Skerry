import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
test('桌面随机端口、独立数据目录、父进程退出清理服务',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agents-desktop-'));
 const child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:'0',AGENTS_DESKTOP:'1',AGENTS_DATA_DIR:dir,MULTI_AGENT_SECRETS:path.join(dir,'secrets')},stdio:['pipe','pipe','pipe']});
 try {
 const first=await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('启动超时')),10000);timer.unref();})]);
 const address=first[0].toString().trim().replace('AGENTS_READY ','');assert.match(address,/^http:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(new URL(address).port,'0');
 const state=await (await fetch(address+'/api/state')).json();assert.equal(state.projects.length,0);
 const save=await fetch(address+'/api/connection',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify({name:'desktop test',baseUrl:'https://example.com/v1',protocol:'openai'})});assert.equal(save.status,200);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'workspace.json'))).connections[0].name,'desktop test');
 const exited=once(child,'exit');child.stdin.end();await exited;await assert.rejects(()=>fetch(address+'/api/state'));
 }finally{if(child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
