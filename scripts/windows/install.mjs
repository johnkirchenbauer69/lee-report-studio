import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scripts=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(scripts,'../..');
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const run=(exe,args)=>new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Setup step failed (exit ${code}).`)));
});
try {
  await access(npm);
  if(!process.argv.includes('--skip-install'))await run(process.execPath,[npm,'ci']);
  await run(process.execPath,[npm,'run','build']);
  await run('cscript.exe',['//nologo',path.join(scripts,'CreateShortcut.vbs'),root,process.execPath]);
  console.log('Double-click Lee Report Studio on your Desktop. Existing configuration and data were preserved.');
}catch(e){console.error(`Lee Report Studio setup failed: ${e.message}`);process.exitCode=1;}
