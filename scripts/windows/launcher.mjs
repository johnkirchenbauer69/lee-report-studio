import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, access, appendFile, readFile } from 'node:fs/promises';
import { fork, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { config } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
config({path:path.join(root,'.env'),quiet:true});
const identity = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12);
const port = Number(process.env.LEE_LAUNCH_PORT ?? 8799);
const apiPort = Number(process.env.LEE_LAUNCH_API_PORT ?? process.env.PORT ?? 8787);
const url = `http://127.0.0.1:${port}`;
const appUrl = `http://127.0.0.1:${apiPort}`;
const logs = path.join(process.env.LOCALAPPDATA ?? tmpdir(), 'LeeReportStudio', identity);
await mkdir(logs, { recursive:true });
const logFile = path.join(logs, 'launcher.log');
const log = async message => {
  try { await appendFile(logFile, `${new Date().toISOString()} ${message}\n`); }
  catch(e) { error=`Troubleshooting log could not be written: ${e.message}`; console.error(error); }
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const browser = destination => {
  if (process.argv.includes('--no-open')) return;
  const child = process.platform === 'win32'
    ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', destination], {windowsHide:true, stdio:'ignore'})
    : spawn('xdg-open', [destination], {stdio:'ignore'});
  child.on('error', e => void log(`Browser could not open: ${e.message}. Open ${destination}`));
  child.unref();
};
const get = async endpoint => {
  const response = await fetch(endpoint, {signal:AbortSignal.timeout(1500)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
};
const occupied = target => new Promise(resolve => {
  const socket = net.connect({host:'127.0.0.1',port:target});
  socket.once('connect', () => {socket.destroy(); resolve(true);});
  socket.once('error', () => resolve(false));
});
let state = 'starting', error = '', api, stopping = false, childReady = false;
const token = randomUUID();
const status = () => ({application:'lee-report-studio-launcher', workspace:identity, state, error, appUrl, logFile, childAlive: Boolean(api?.connected)});
const page = () => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lee Report Studio — Local launch</title><style>body{font:16px "Segoe UI",sans-serif;background:#edf0f4;color:#172033;margin:0}main{max-width:680px;margin:8vh auto;padding:36px;background:white;border-radius:12px}h1{color:#163a63}a,button{font:inherit;padding:10px 16px;color:#163a63}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;margin-top:24px;color:#526174}</style><main><p>LEE &amp; ASSOCIATES</p><h1>Lee Report Studio</h1><p id="state" role="status">${escape(state)}</p><pre id="error">${escape(error)}</pre><p><a href="${appUrl}" id="open" ${state==='ready'?'':'hidden'}>Open Report Studio</a> <a href="/logs">Troubleshooting logs</a></p><p>Closing a report tab keeps the local server running. Before stopping, finish editing and confirm your report is saved.</p><button id="stop" ${['ready','failed'].includes(state)?'':'disabled'} onclick="stopApp()">Stop local application</button><small>Local application · Your existing data and configuration stay in this project.</small></main><script>async function stopApp(){if(!confirm('Finish editing and confirm your changes are saved before stopping. Stop Lee Report Studio?'))return;const s=await(await fetch('/status')).json();const r=await fetch(s.childAlive?'/stop':'/close',{method:'POST',headers:{'x-launch-token':${JSON.stringify(token)}}});if(!r.ok)document.getElementById('error').textContent=await r.text()}setInterval(async()=>{try{const s=await(await fetch('/status')).json();document.getElementById('state').textContent=s.state==='ready'?'Ready to open':s.state;document.getElementById('error').textContent=s.error;document.getElementById('open').hidden=s.state!=='ready';document.getElementById('stop').disabled=!['ready','failed'].includes(s.state);}catch{document.getElementById('state').textContent='Local application stopped. Launch again from your desktop shortcut.'}},1000)</script></html>`;
const controller = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.url === '/status') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(status()));return;}
  if (req.url === '/logs') {
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    try {res.end((await readFile(logFile,'utf8')).slice(-50000));}
    catch(e) {res.writeHead(500);res.end(`Troubleshooting log could not be read: ${e.message}`);}
    return;
  }
  if (req.url === '/close' && req.method === 'POST') {
    if(req.headers['x-launch-token']!==token || api?.connected){res.writeHead(409);res.end('A live application must be stopped through its normal control.');return;}
    res.end('Launch session closed.');controller.close(()=>process.exit(0));return;
  }
  if (req.url === '/stop' && req.method === 'POST') {
    if (req.headers['x-launch-token'] !== token) {res.writeHead(403);res.end('Please use the local launch page.');return;}
    if (!api?.connected || stopping) {res.writeHead(409);res.end('The local application is not ready to stop.');return;}
    api.send({type:'lee-desktop-stop'});
    const reply = message => {
      if (message?.type !== 'lee-desktop-stop-result') return;
      clearTimeout(timeout); api.off('message',reply);
      if (!message.ok) {res.writeHead(409);res.end(message.error);return;}
      stopping=true; state='stopping'; res.end('Stopping after active requests finish.');
    };
    const timeout=setTimeout(()=>{api.off('message',reply);res.writeHead(504);res.end('Stop was not acknowledged. No process was forcibly terminated.');},5000);
    api.on('message',reply);
    return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());
});
try {
  await new Promise((resolve,reject)=>{controller.once('error',reject);controller.listen(port,'127.0.0.1',resolve);});
} catch (e) {
  if(e.code==='EADDRINUSE') {
    try {
      const existing=await (await get(`${url}/status`)).json();
      if(existing.application==='lee-report-studio-launcher' && existing.workspace===identity) {browser(existing.state==='ready'?existing.appUrl:url);process.exit(0);}
    } catch {}
  }
  await log(`Cannot open launch control port ${port}: ${e.message}`);
  console.error(`Lee Report Studio launcher failed: ${e.message}. Logs: ${logFile}`);
  // Windows hidden launches still need a visible error when no control page can bind.
  if(process.platform==='win32') spawn('wscript.exe',[path.join(root,'scripts/windows/LaunchError.vbs'),`Lee Report Studio could not start. Port ${port} is already in use or unavailable. No processes were stopped. Logs: ${logFile}`],{windowsHide:true});
  process.exit(1);
}
browser(url);
try {
  await access(path.join(root,'dist/index.html'));
  await access(path.join(root,'node_modules/tsx/dist/loader.mjs'));
  if(await occupied(apiPort)) throw new Error(`Port ${apiPort} is already in use. Close the existing Report Studio server using its normal controls, then launch again. No existing process was changed.`);
  await log(`Starting ${root} on ${appUrl}`);
  api=fork(path.join(root,'server/index.ts'),[],{
    cwd:root, execArgv:['--import','tsx'], silent:true, windowsHide:true,
    env:{...process.env, PORT:String(apiPort), LEE_RENDER_APP_URL:appUrl, LEE_DESKTOP_LAUNCHER:'1'},
  });
  api.stdout.on('data',data=>void log(`API ${data.toString().trimEnd()}`));
  api.stderr.on('data',data=>void log(`API ${data.toString().trimEnd()}`));
  api.on('error',e=>{state='failed';error=e.message;void log(error);});
  api.on('message',message=>{if(message?.type==='lee-desktop-ready')childReady=true;});
  api.on('exit',code=>{
    if(stopping){controller.close(()=>process.exit(0));return;}
    state='failed';error=`The application stopped (exit ${code}). Review the troubleshooting logs. Close this launch session with the button below and launch again.`;
    void log(error);
  });
  const deadline=Date.now()+60000;
  while(Date.now()<deadline && state==='starting') {
    try {
      if(!childReady) throw new Error('Waiting for the owned API listener');
      const health=await (await get(`${appUrl}/api/health`)).json();
      if(!health.ok) throw new Error('API not ready');
      await get(appUrl);
      state='ready';browser(appUrl);await log('Ready');break;
    } catch {await new Promise(resolve=>setTimeout(resolve,300));}
  }
  if(state==='starting') throw new Error('Startup did not become ready within 60 seconds. Review logs; do not start a second server.');
} catch(e) {state='failed';error=e.code==='ENOENT'?'One-time setup is incomplete. Double-click scripts/windows/Install.cmd to install dependencies and build the app.':e.message;await log(error);}
