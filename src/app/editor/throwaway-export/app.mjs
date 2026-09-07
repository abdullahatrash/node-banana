import { overlayLayout, paintOverlay } from '/overlay.mjs';
const $=id=>document.getElementById(id);
const files={};const objectUrls={};let worker=null;let playing=false;let running=false;let outputName=null;
let frameTimes=[],longTasks=[],pingTimes=[],heapPeak=0,lastFrame=performance.now(),progressStarted=0;
window.prototypeResults=null;
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
let textPosition={x:0.5,y:0.92};let textEditing=false;let overlayDrag=null;let overlayState;
const textStyle=()=>({fontSize:Number($('textSize').value),fontWeight:Number($('textWeight').value),align:$('textAlign').value,color:$('textColor').value,backgroundColor:$('textBackground').value,backgroundOpacity:Number($('textOpacity').value)/100});
const config=()=>({...Object.fromEntries(['layout','duration','reactionStart','text','mainGain','reactionGain','musicGain','voiceGain'].map(key=>[key,['layout','text'].includes(key)?$(key).value:Number($(key).value)])),textPosition:{...textPosition},textStyle:textStyle()});
function renderOverlay(){
  const canvas=$('captionCanvas'),context=canvas.getContext('2d');
  overlayState=overlayLayout(context,$('text').value,textPosition,textStyle());
  textPosition={x:overlayState.x/1080,y:overlayState.y/1920};
  const scale=$('preview').clientWidth/1080;
  Object.assign($('caption').style,{left:`${textPosition.x*100}%`,top:`${textPosition.y*100}%`,width:`${overlayState.width*scale}px`,height:`${overlayState.height*scale}px`});
  const background=overlayState.backgroundColor;
  const rgb=[1,3,5].map(start=>parseInt(background.slice(start,start+2),16)).join(',');
  Object.assign($('captionEditor').style,{font:`${overlayState.fontWeight} ${overlayState.fontSize*scale}px ReactionArabic`,lineHeight:`${overlayState.lineHeight*scale}px`,padding:`${24*scale}px ${32*scale}px`,textAlign:overlayState.align,color:overlayState.color,backgroundColor:`rgba(${rgb},${overlayState.backgroundOpacity})`});
  canvas.width=overlayState.width;canvas.height=overlayState.height;
  if($('text').value)paintOverlay(context,$('text').value,overlayState);
  if(!textEditing)$('captionEditor').value=$('text').value;
  $('opacityValue').textContent=`${$('textOpacity').value}%`;
  $('caption').setAttribute('aria-label',`Text overlay: ${$('text').value||'empty'}. Drag to move; Enter to edit; arrow keys to move.`);
}
function startTextEdit(){
  pause();textEditing=true;$('caption').classList.add('editing','selected');
  $('captionEditor').value=$('text').value;$('captionEditor').focus();$('captionEditor').select();
}
function finishTextEdit(){
  textEditing=false;$('caption').classList.remove('editing');renderOverlay();
}
$('caption').ondblclick=()=>{if(!textEditing)startTextEdit();};
$('caption').onpointerdown=e=>{
  if(textEditing||e.button!==0)return;
  $('caption').focus({preventScroll:true});$('caption').classList.add('selected');
  overlayDrag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...textPosition}};
  $('caption').setPointerCapture(e.pointerId);
};
$('caption').onpointermove=e=>{
  if(!overlayDrag||e.pointerId!==overlayDrag.id)return;
  const bounds=$('preview').getBoundingClientRect();
  const dx=e.clientX-overlayDrag.x,dy=e.clientY-overlayDrag.y;
  if(Math.abs(dx)+Math.abs(dy)<3)return;
  $('caption').classList.add('dragging');
  textPosition={x:overlayDrag.start.x+dx/bounds.width,y:overlayDrag.start.y+dy/bounds.height};renderOverlay();
};
function endOverlayDrag(){overlayDrag=null;$('caption').classList.remove('dragging');}
$('caption').onpointerup=endOverlayDrag;$('caption').onpointercancel=endOverlayDrag;$('caption').onlostpointercapture=endOverlayDrag;
$('caption').onkeydown=e=>{
  if(textEditing)return;
  if(e.key==='Enter'){e.preventDefault();startTextEdit();return;}
  const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(steps[e.key]){e.preventDefault();const [x,y]=steps[e.key],step=e.shiftKey?20:4;textPosition={x:textPosition.x+x*step/1080,y:textPosition.y+y*step/1920};renderOverlay();}
};
$('captionEditor').oninput=()=>{$('text').value=$('captionEditor').value;renderOverlay();};
$('captionEditor').onkeydown=e=>{
  if(e.isComposing)return;
  if(e.key==='Escape'||e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();$('captionEditor').blur();$('caption').focus();}
};
$('captionEditor').onblur=finishTextEdit;
$('text').addEventListener('input',renderOverlay);
for(const id of ['textSize','textWeight','textAlign','textColor','textBackground','textOpacity'])$(id).addEventListener('input',renderOverlay);
Promise.all([100,300,400,700].map(weight=>document.fonts.load(`${weight} 76px ReactionArabic`))).then(renderOverlay);new ResizeObserver(renderOverlay).observe($('preview'));
if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{if(running)longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask'});
function sync(){
  const c=config(),t=$('main').currentTime;
  const reactionEnd=Math.min($('reaction').duration||15,15);
  $('preview').className=`preview ${c.layout}${t>=c.reactionStart&&t<c.reactionStart+reactionEnd?' active':''}`;
  for(const [name,start] of [['reaction',c.reactionStart],['music',0],['voice',2]]){
    const media=$(name);const local=t-start;const active=local>=0&&local<Math.min(media.duration||0,name==='reaction'?15:60);
    if(!active){media.pause();continue;}
    if(Math.abs(media.currentTime-local)>.12)media.currentTime=local;
    if(playing&&media.paused)media.play().catch(()=>{});if(!playing)media.pause();
  }
  for(const name of ['main','reaction','music','voice'])$(name).volume=c[`${name}Gain`];
  $('time').textContent=`${t.toFixed(1)} seconds`;$('seek').value=t;
  if(t>=c.duration&&playing)pause();
}
function loop(now){if(running){frameTimes.push(now-lastFrame);heapPeak=Math.max(heapPeak,performance.memory?.usedJSHeapSize||0);}lastFrame=now;if(playing)sync();requestAnimationFrame(loop);}
requestAnimationFrame(loop);
function pause(){playing=false;for(const name of ['main','reaction','music','voice'])$(name).pause();}
async function assign(name,file){
  if(objectUrls[name])URL.revokeObjectURL(objectUrls[name]);
  files[name]=file;objectUrls[name]=URL.createObjectURL(file);$(name).src=objectUrls[name];
  await new Promise((resolve,reject)=>{$(name).onloadedmetadata=resolve;$(name).onerror=()=>reject(new Error(`Cannot play ${name}`));});
  $('export').disabled=!(files.main&&files.reaction);
}
for(const name of ['main','reaction','music','voice'])$(`${name}File`).onchange=async e=>{try{await assign(name,e.target.files[0]);sync();}catch(error){$('status').textContent=error.message;}};
$('fixtures').onclick=async()=>{
  const start=performance.now();$('fixtures').disabled=true;$('status').textContent='Loading local fixtures…';
  try{
    for(const [name,ext] of [['main','mp4'],['reaction','mp4'],['music','wav'],['voice','wav']]){
      const blob=await(await fetch(`/media/${name}.${ext}`)).blob();await assign(name,new File([blob],`${name}.${ext}`,{type:blob.type}));
    }
    window.fixtureLoadMs=performance.now()-start;$('status').textContent=`Local fixtures loaded in ${(window.fixtureLoadMs/1000).toFixed(2)}s. Audio tones identify the four sources.`;sync();
  }catch(error){$('status').textContent=error.message;}finally{$('fixtures').disabled=false;}
};
$('play').onclick=()=>{if(playing)pause();else{playing=true;$('main').play().catch(()=>{playing=false;});sync();}};
$('seek').oninput=()=>{$('main').currentTime=Number($('seek').value);sync();};
for(const id of ['layout','reactionStart','duration','text','mainGain','reactionGain','musicGain','voiceGain'])$(id).oninput=sync;
$('ping').onclick=()=>{const start=performance.now();$('clicks').textContent=Number($('clicks').textContent)+1;requestAnimationFrame(()=>{if(running)pingTimes.push(performance.now()-start);});};
async function cleanOutput(){if(outputName){await(await navigator.storage.getDirectory()).removeEntry(outputName).catch(()=>{});outputName=null;}}
$('export').onclick=async()=>{
  if(running)return;pause();
  running=true;window.prototypeResults=null;$('export').disabled=true;
  const exportConfig=config();
  if(worker){worker.terminate();worker=null;}await cleanOutput();
  for(const id of ['download','report']){if($(id).href)URL.revokeObjectURL($(id).href);$(id).hidden=true;}
  $('result').pause();$('result').removeAttribute('src');$('result').load();$('result').style.display='none';
  frameTimes=[];longTasks=[];pingTimes=[];heapPeak=0;window.prototypeResults=null;running=true;
  lastFrame=performance.now();progressStarted=lastFrame;
  $('export').disabled=true;$('cancel').disabled=false;$('progress').value=0;$('status').textContent='Exporting locally in a worker. Try the click counter.';
  outputName=`throwaway-reaction-${crypto.randomUUID()}.mp4`;
  worker=new Worker('/worker.mjs',{type:'module'});
  const finish=()=>{running=false;$('export').disabled=false;$('cancel').disabled=true;};
  worker.onerror=e=>{finish();$('status').textContent=`Worker failed: ${e.message}`;window.prototypeResults={status:'error',message:e.message};cleanOutput();};
  worker.onmessage=({data})=>{
    if(data.type==='preparing'){$('status').textContent=data.message;return;}
    if(data.type==='progress'){$('progress').value=data.progress;$('status').textContent=`Exporting ${data.progress.toFixed(0)}% · ${(data.elapsedMs/1000).toFixed(1)}s`;return;}
    if(data.type!=='done'){finish();$('status').textContent=data.message||'Cancelled';window.prototypeResults={status:data.type,message:data.message};return;}
    finish();$('progress').value=100;
    const metrics={status:'complete',...data.metrics,endToEndMs:performance.now()-progressStarted,fixtureLoadMs:window.fixtureLoadMs||null,mainFrameGapP95Ms:percentile(frameTimes,.95),mainFrameGapMaxMs:Math.max(0,...frameTimes),mainLongTaskCount:longTasks.length,mainLongTaskMaxMs:Math.max(0,...longTasks),clickPaintP95Ms:percentile(pingTimes,.95),measuredClicks:pingTimes.length,mainHeapPeakBytes:heapPeak||null,heapWarning:'JS heap excludes worker/native/GPU memory; process memory must be measured separately.',browser:navigator.userAgent,logicalCpus:navigator.hardwareConcurrency,reportedDeviceMemoryGiB:navigator.deviceMemory||null,config:exportConfig};
    window.prototypeResults=metrics;$('metrics').textContent=JSON.stringify(metrics,null,2);
    $('status').textContent=`Finished in ${(metrics.exportMs/1000).toFixed(1)}s. This machine only; ordinary-laptop qualification remains open.`;
    $('download').href=URL.createObjectURL(data.file);$('download').hidden=false;
    $('report').href=URL.createObjectURL(new Blob([JSON.stringify(metrics,null,2)],{type:'application/json'}));$('report').hidden=false;
    $('result').src=$('download').href;$('result').style.display='block';
  };
  worker.postMessage({type:'export',files,config:exportConfig,outputName});
};
$('cancel').onclick=()=>{worker?.postMessage({type:'cancel'});$('status').textContent='Cancelling and cleaning the temporary output…';};
window.addEventListener('beforeunload',()=>{worker?.terminate();cleanOutput();});
