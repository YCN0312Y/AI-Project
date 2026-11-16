const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),url='http://localhost:8136/';
async function ready(){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(1000)});
    if(!response.ok)return false;
    return (await response.text()).includes('preview/bootstrap.js');
  }catch{return false}
}
(async()=>{
  if(!await ready()){
    const logDir=path.join(root,'verification');fs.mkdirSync(logDir,{recursive:true});
    const out=fs.openSync(path.join(logDir,'preview-server.log'),'a'),err=fs.openSync(path.join(logDir,'preview-server-error.log'),'a');
    try{
      const child=spawn(process.execPath,[path.join(__dirname,'serve.cjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
      child.unref();
    }finally{fs.closeSync(out);fs.closeSync(err)}
    let started=false;
    for(let attempt=0;attempt<12;attempt++){
      if(await ready()){started=true;break}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!started)throw new Error('Could not start the game on port 8136. Check verification/preview-server-error.log.');
  }
  console.log('Game is ready: '+url);
  if(!process.argv.includes('--no-open')){
    const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,windowsHide:true,stdio:'ignore'});
    browser.on('error',error=>console.error('Open '+url+' manually. '+error.message));browser.unref();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
