// THROWAWAY: reproduce input-rate support and isolate AAC timing from the video mixer.
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PROTOTYPE_AUTOMATION_ROOT?join(process.env.PROTOTYPE_AUTOMATION_ROOT,'playwright'):'playwright');
const root=process.env.PROTOTYPE_AUDIO_RESULTS_DIR||join(tmpdir(),'tasmeemai-reaction-audio-diagnosis');await mkdir(root,{recursive:true});
function marker(rate){const frames=rate*3,data=Buffer.alloc(44+frames*4);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*4,28);data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){const t=i/rate-.5;const sample=t>=0&&t<.2?.4*Math.sin(2*Math.PI*997*t)*Math.sin(Math.PI*t/.2)**2:0;data.writeInt16LE(Math.round(sample*32767),44+i*4);data.writeInt16LE(Math.round(sample*32767),46+i*4);}return data;}
for(const rate of [48000,44100])await writeFile(`${root}/marker-${rate}.wav`,marker(rate));
const cases=[
 {rate:48000,extension:'wav',name:'48000-wav'},
 {rate:44100,extension:'wav',name:'44100-wav'},
 {rate:44100,extension:'mp3',name:'44100-cbr',args:['-b:a','128k','-metadata','title=MP3 regression marker']},
 {rate:44100,extension:'mp3',name:'44100-vbr',args:['-q:a','3']},
 {rate:48000,extension:'mp3',name:'48000-mono',args:['-ac','1','-b:a','64k']},
 {rate:44100,extension:'mp3',name:'44100-no-tags',args:['-b:a','128k','-write_xing','0','-id3v2_version','0','-joint_stereo','0']},
];
for(const item of cases)if(item.extension==='mp3')execFileSync('ffmpeg',['-v','error','-y','-i',`${root}/marker-${item.rate}.wav`,'-c:a','libmp3lame',...item.args,`${root}/marker-${item.name}.mp3`]);
// Search ±85 ms around a known, windowed tone. FFmpeg is a diagnostic decoder only.
function alignment(path){
 const bytes=execFileSync('ffmpeg',['-v','error','-i',path,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1'],{maxBuffer:4*1024*1024});
 const decoded=Float32Array.from({length:bytes.length/4},(_,i)=>bytes.readFloatLE(i*4));
 const reference=Float32Array.from({length:9600},(_,i)=>.4*Math.sin(2*Math.PI*997*i/48000)*Math.sin(Math.PI*i/9600)**2);
 const referencePower=reference.reduce((sum,value)=>sum+value*value,0);
 let best=-Infinity,delay=0;
 for(let lag=-4096;lag<=4096;lag++){
  let dot=0,power=0;
  for(let i=0;i<reference.length;i++){const value=decoded[120000+lag+i]||0;dot+=reference[i]*value;power+=value*value;}
  const score=dot/Math.sqrt(referencePower*power||1);
  if(score>best){best=score;delay=lag;}
 }
 return{file:path.split('/').at(-1),decodedFrames:decoded.length,correlationDelayFrames:delay,correlationDelayMs:delay/48,correlation:best,trailingFramesAfterShift:decoded.length-240000-delay};
}
const browser=await chromium.launch({channel:'chrome',headless:false});
try{
 const page=await browser.newPage({acceptDownloads:true});await page.goto(process.env.PROTOTYPE_URL||'http://127.0.0.1:3047');await page.locator('#fixtures').click();await page.waitForFunction(()=>!document.getElementById('fixtures').disabled);
 for(const id of ['mainGain','reactionGain','musicGain']){await page.locator('#'+id).fill('0');await page.locator('#'+id).dispatchEvent('input');}
 await page.locator('#voiceGain').fill('1');await page.locator('#duration').fill('5');
 const results=[];
 for(const {rate,extension,name} of cases){
  await page.locator('#voiceFile').setInputFiles(`${root}/marker-${extension==='wav'?rate:name}.${extension}`);await page.waitForFunction(()=>document.getElementById('voice').readyState>=1);
  await page.locator('#export').click();await page.waitForFunction(()=>window.prototypeResults!==null);
  const result=await page.evaluate(()=>window.prototypeResults);
  const remainingTemporaryAudio=await page.evaluate(async()=>{const names=[];for await(const [name]of(await navigator.storage.getDirectory()).entries())if(name.endsWith('.wav'))names.push(name);return names;});
  const record={rate,extension,name,...result,remainingTemporaryAudio};results.push(record);
  if(result.status==='complete'){const dl=page.waitForEvent('download');await page.locator('#download').click();const path=`${root}/mixed-${name}.mp4`;await(await dl).saveAs(path);record.alignment=alignment(path);}
 }
 const direct=await page.evaluate(async()=>{
  const {Output,Mp4OutputFormat,BufferTarget,AudioSampleSource,AudioSample}=await import('/mediabunny.mjs');
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target});let end=0,count=0;
  const audio=new AudioSampleSource({codec:'aac',bitrate:128000,onEncodedPacket:p=>{end=p.timestamp+p.duration;count++;}});output.addAudioTrack(audio);await output.start();
  for(let frame=0;frame<150;frame++){const pcm=new Float32Array(3200);for(let j=0;j<1600;j++){const t=(frame*1600+j)/48000-2.5;const value=t>=0&&t<.2?.4*Math.sin(2*Math.PI*997*t)*Math.sin(Math.PI*t/.2)**2:0;pcm[j*2]=value;pcm[j*2+1]=value;}const sample=new AudioSample({data:pcm,format:'f32',numberOfChannels:2,sampleRate:48000,timestamp:frame/30});await audio.add(sample);sample.close();}
  audio.close();await output.finalize();const a=document.createElement('a');a.id='directDownload';a.href=URL.createObjectURL(new Blob([target.buffer],{type:'audio/mp4'}));a.download='direct.m4a';a.textContent='Direct audio';document.body.append(a);return{end,count,requestedFrames:240000};
 });
 const dl=page.waitForEvent('download');await page.locator('#directDownload').click();await(await dl).saveAs(`${root}/direct.m4a`);
 direct.alignment=alignment(`${root}/direct.m4a`);
 const invalidMp3Rejected=await page.evaluate(async()=>{
  const {Input,ALL_FORMATS,BlobSource}=await import('/mediabunny.mjs');
  const input=new Input({source:new BlobSource(new File(['invalid MP3 data'], 'invalid.mp3',{type:'audio/mpeg'})),formats:ALL_FORMATS});
  try{await input.getPrimaryAudioTrack();return false;}catch{return true;}finally{input.dispose();}
 });
 await writeFile(`${root}/results.json`,JSON.stringify({results,direct,invalidMp3Rejected},null,2));console.log(JSON.stringify({results:results.map(r=>({name:r.name,status:r.status,message:r.message,end:r.audioLastPacketEnd,normalized:r.normalizedAudioSources,alignment:r.alignment,remainingTemporaryAudio:r.remainingTemporaryAudio})),direct,invalidMp3Rejected}));
 assert.ok(invalidMp3Rejected,'An MP3 extension must not bypass format validation');
 for(const result of results){
  assert.equal(result.status,'complete',`${result.rate} Hz ${result.extension}: ${result.message||'export failed'}`);
  assert.deepEqual(result.remainingTemporaryAudio,[],'Temporary audio must be removed');
  assert.ok(result.alignment.correlation>.99,'Export must retain the audio marker');
  // WAV resampling must preserve timing. MP3 encoder padding is measured above
  // and remains part of the deferred timing work; do not hide it with a fixed trim.
  if(result.extension==='wav')assert.ok(Math.abs(result.alignment.correlationDelayFrames-direct.alignment.correlationDelayFrames)<=48,'WAV audio must align within 1 ms of direct AAC');
 }
}finally{await browser.close();}
