import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import http from 'node:http';

const control='http://127.0.0.1:8830';
const isolated=await mkdtemp(path.join(tmpdir(),'lee-report-studio-launcher-test-'));
const env={...process.env,NODE_ENV:'test',REPORT_DATA_MODE:'mock',NARRATIVE_MODEL_PROVIDER:'mock',LEE_DATA_DIR:isolated,LEE_LAUNCH_PORT:'8830',LEE_LAUNCH_API_PORT:'8831'};
const start=() => spawn(process.execPath,['scripts/windows/launcher.mjs','--no-open'],{env,stdio:'pipe',windowsHide:true});
const wait=async predicate=>{const until=Date.now()+65000;while(Date.now()<until){try{if(await predicate())return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Readiness timeout');};
const status=async()=>await(await fetch(control+'/status')).json();
const stop=async()=>{
  const html=await(await fetch(control)).text();
  const token=JSON.parse(html.match(/'x-launch-token':("[^"]+")/)[1]);
  const result=await fetch(control+'/stop',{method:'POST',headers:{'x-launch-token':token}});
  assert.equal(result.status,200);
  await wait(async()=>{try{await fetch(control);return false;}catch{return true;}});
};
const results=[];
await mkdir('docs/evidence/ux-ui',{recursive:true});
let child=start();
try {
  await wait(async()=>(await status()).state==='ready');
  assert.equal((await(await fetch('http://127.0.0.1:8831/api/health')).json()).dataRoot,path.resolve(isolated));
  results.push('start: ready with isolated disk storage and built interface');
  const duplicate=start();
  const duplicateCode=await new Promise(resolve=>duplicate.on('exit',resolve));
  assert.equal(duplicateCode,0);assert.equal((await status()).state,'ready');
  results.push('duplicate launch: reused control session, no second API');
  assert.equal((await fetch(control+'/stop',{method:'POST'})).status,403);
  results.push('stop: rejected unauthenticated request');
  const held=http.request('http://127.0.0.1:8831/api/render/pdf',{
    method:'POST',headers:{'content-type':'application/json','content-length':'1024'},
  });
  held.on('error',()=>{});
  const connected=new Promise(resolve=>held.once('socket',socket=>socket.once('connect',resolve)));
  held.write('{');await connected;
  await new Promise(resolve=>setTimeout(resolve,100));
  try {
    const html=await(await fetch(control)).text();
    const token=JSON.parse(html.match(/'x-launch-token':("[^"]+")/)[1]);
    const busy=await fetch(control+'/stop',{method:'POST',headers:{'x-launch-token':token}});
    assert.equal(busy.status,409);assert.match(await busy.text(),/still running/);
    results.push('busy stop: refused while an API request was in flight');
  } finally {held.destroy();}
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await page.goto(control);await page.screenshot({path:'docs/evidence/ux-ui/launcher-ready.png'});
  await page.goto('http://127.0.0.1:8831');await page.locator('.app-shell').waitFor();
  await page.screenshot({path:'docs/evidence/ux-ui/launcher-built-app.png'});
  await browser.close();
  await stop();
  results.push('graceful stop: API and controller closed');
  child=start();await wait(async()=>(await status()).state==='ready');
  await stop();results.push('restart: became ready again without duplicate servers');
  const sentinel=http.createServer((_req,res)=>res.end('unrelated test listener'));
  await new Promise(resolve=>sentinel.listen(8831,'127.0.0.1',resolve));
  const collision=start();
  await wait(async()=>(await status()).state==='failed');
  assert.match((await status()).error,/already in use/);
  assert.equal(await(await fetch('http://127.0.0.1:8831')).text(),'unrelated test listener');
  const html=await(await fetch(control)).text();
  const token=JSON.parse(html.match(/'x-launch-token':("[^"]+")/)[1]);
  assert.equal((await fetch(control+'/close',{method:'POST',headers:{'x-launch-token':token}})).status,200);
  results.push('occupied application port: explicit failure, unrelated listener preserved');
  await new Promise(resolve=>collision.on('exit',resolve));
  await new Promise(resolve=>sentinel.close(resolve));
} finally {
  try{if((await status()).childAlive)await stop();}catch{}
}
await mkdir('docs/evidence/ux-ui',{recursive:true});
await writeFile('docs/evidence/ux-ui/launcher-verification.json',JSON.stringify({mode:'isolated task simulation',results},null,2));
console.log(`${results.length} launcher checks passed`);
