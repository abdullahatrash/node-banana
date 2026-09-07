// Measurement harness, not a production test suite. Requires Playwright + Chrome.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require=createRequire(import.meta.url),run=promisify(execFile);
const {chromium}=require(process.env.PROTOTYPE_AUTOMATION_ROOT?join(process.env.PROTOTYPE_AUTOMATION_ROOT,'playwright'):'playwright');
const results=process.env.PROTOTYPE_RESULTS_DIR||join(tmpdir(),'tasmeemai-throwaway-reaction-results');
await mkdir(results,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.PROTOTYPE_HEADLESS==='1',args:['--enable-precise-memory-info']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:1100},acceptDownloads:true});
  page.on('pageerror',error=>console.log('PAGE ERROR:',error.message));
  const cdp=await browser.newBrowserCDPSession();
  const system=await cdp.send('SystemInfo.getInfo');
  const hardware={cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramGiB:totalmem()/1024**3,headless:process.env.PROTOTYPE_HEADLESS==='1',gpu:system.gpu.devices,featureStatus:system.gpu.featureStatus};
  await page.goto(process.env.PROTOTYPE_URL||'http://127.0.0.1:3047');
  await page.getByRole('button',{name:'Load local test clips'}).click();
  await page.waitForFunction(()=>!document.getElementById('export').disabled,{},{timeout:60_000});
  await page.waitForFunction(()=>!document.getElementById('fixtures').disabled,{},{timeout:60_000});
  for(const [name,path] of [['music',process.env.PROTOTYPE_MUSIC],['voice',process.env.PROTOTYPE_VOICE]]){
    if(!path)continue;
    await page.locator(`#${name}File`).setInputFiles(path);
    await page.waitForFunction(id=>document.getElementById(id).readyState>=1,name);
  }
  const cases=(process.env.PROTOTYPE_CASES||'stack:60,overlay:60,side:60').split(',');
  const records=[];
  if(process.env.PROTOTYPE_CHECK_CANCEL==='1'){
    await page.getByRole('button',{name:'Measure MP4 export'}).click();
    const cancelDuringPreparation=process.env.PROTOTYPE_CANCEL_PHASE==='prepare';
    await page.waitForFunction(preparing=>(preparing?document.getElementById('status').textContent.startsWith('Preparing '):document.getElementById('progress').value>1)||window.prototypeResults!==null,cancelDuringPreparation,{polling:10});
    const earlyResult=await page.evaluate(()=>window.prototypeResults);
    if(earlyResult)throw new Error(`Export ended before cancellation: ${JSON.stringify(earlyResult)}`);
    const start=Date.now();await page.locator('#cancel').click();
    await page.waitForFunction(()=>window.prototypeResults?.status==='cancelled');
    const remaining=await page.evaluate(async()=>{const names=[];for await(const [name]of(await navigator.storage.getDirectory()).entries())names.push(name);return names;});
    const cancelled={status:'cancelled',requestedPhase:cancelDuringPreparation?'prepare':'render',cancelMs:Date.now()-start,remainingTemporaryOutputs:remaining};
    console.log(JSON.stringify(cancelled));await writeFile(join(results,'cancellation.json'),JSON.stringify(cancelled,null,2));
  }
  for(const entry of cases){
    const [layout,length]=entry.split(':');
    await page.locator('#layout').selectOption(layout);
    await page.locator('#duration').fill(length);
    await page.locator('#reactionStart').fill(length==='5'?'0':'5');
    const sampleMemory=async()=>{
      const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
      const {stdout}=await run('ps',['-o','rss=','-p',processInfo.map(p=>p.id).join(',')]);
      return stdout.trim().split(/\s+/).reduce((sum,rss)=>sum+Number(rss)*1024,0);
    };
    const memory=[await sampleMemory()];
    await page.getByRole('button',{name:'Measure MP4 export'}).click();
    const deadline=Date.now()+180_000;
    for(;;){
      if(Date.now()>deadline)throw new Error('Export measurement exceeded three minutes.');
      await page.waitForTimeout(750);
      await page.locator('#ping').click();
      memory.push(await sampleMemory());
      const state=await page.evaluate(()=>window.prototypeResults);
      if(state){
        const remainingTemporaryAudio=await page.evaluate(async()=>{const names=[];for await(const [name]of(await navigator.storage.getDirectory()).entries())if(name.endsWith('.wav'))names.push(name);return names;});
        const record={...state,hardware,sessionRssBaselineBytes:memory[0],sessionRssPeakBytes:Math.max(...memory),rssNote:'Sum of browser-session process RSS, including shared pages; not unique/private memory.',memorySamples:memory.length,remainingTemporaryAudio};
        records.push(record);
        await writeFile(join(results,`${layout}-${length}.json`),JSON.stringify(record,null,2));
        console.log(JSON.stringify(record));
        if(state.status!=='complete')throw new Error(state.message);
        const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();
        await(await downloadPromise).saveAs(join(results,`${layout}-${length}.mp4`));
        await page.locator('#seek').fill('8');await page.locator('#seek').dispatchEvent('input');
        await page.waitForTimeout(500);await page.screenshot({path:join(results,`${layout}-${length}.png`),fullPage:true});
        break;
      }
    }
  }
  await writeFile(join(results,'latest.json'),JSON.stringify(records,null,2));
  console.log(`Saved measurements and MP4s to ${results}`);
}finally{await browser.close();}
