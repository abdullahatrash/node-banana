// THROWAWAY: bounded media pipeline, deliberately limited to 48 kHz audio.
import { Input, BlobSource, ALL_FORMATS, CanvasSink, CanvasSource, AudioSample,
  AudioSampleSink, AudioSampleSource, Output, Mp4OutputFormat, StreamTarget,
  canEncodeVideo, canEncodeAudio } from '/mediabunny.mjs';
import { overlayLayout, paintOverlay } from '/overlay.mjs';

let cancelled = false;
onmessage = async ({ data }) => {
  if (data.type === 'cancel') { cancelled = true; return; }
  if (data.type !== 'export') return;
  cancelled = false;
  const inputs = []; const iterators = []; let output; let destination;
  const started = performance.now();
  const metrics = { clippedAudioSamples:0, workerHeapPeakBytes:null, videoFrames:0 };
  try {
    const { files, config } = data;
    const width=1080,height=1920,fps=30,rate=48000,block=rate/fps;
    if (!await canEncodeVideo('avc',{width,height,bitrate:6_000_000}) || !await canEncodeAudio('aac',{sampleRate:rate,numberOfChannels:2,bitrate:128_000})) throw new Error('This browser cannot encode the required H.264 + AAC MP4.');
    const font = new FontFace('ReactionArabic', await (await fetch('/font.ttf')).arrayBuffer(), { weight:'100 900' });
    await font.load(); self.fonts.add(font);
    async function open(file) {
      if (!file) return null;
      const input = new Input({source:new BlobSource(file),formats:ALL_FORMATS});
      inputs.push(input); return input;
    }
    const main=await open(files.main), reaction=await open(files.reaction);
    const mainTrack=await main.getPrimaryVideoTrack(), reactionTrack=await reaction.getPrimaryVideoTrack();
    if (!mainTrack || !reactionTrack) throw new Error('Both inputs need a video track.');
    const duration=Math.min(config.duration,await main.computeDuration(),60);
    const frameCount=Math.floor(duration*fps);
    if (!frameCount) throw new Error('Main footage is too short.');
    const reactionDuration=Math.min(await reaction.computeDuration(),15);
    const times=Array.from({length:frameCount},(_,i)=>i/fps);
    const mainFrames=new CanvasSink(mainTrack,{poolSize:2}).canvasesAtTimestamps(times);
    const reactionTimes=times.filter(t=>t>=config.reactionStart && t<config.reactionStart+reactionDuration).map(t=>t-config.reactionStart);
    const reactionFrames=new CanvasSink(reactionTrack,{poolSize:2}).canvasesAtTimestamps(reactionTimes);
    iterators.push(mainFrames,reactionFrames);
    const sounds=[];
    for (const [input,offset,length,gain] of [[main,0,duration,config.mainGain],[reaction,config.reactionStart,reactionDuration,config.reactionGain],[await open(files.music),0,duration,config.musicGain],[await open(files.voice),2,duration,config.voiceGain]]) {
      const track=await input?.getPrimaryAudioTrack();
      if (!track || gain===0) continue;
      const iterator=new AudioSampleSink(track).samples(0,length); iterators.push(iterator);
      sounds.push({iterator,offset,length,gain,current:null,done:false});
    }
    async function advance(sound) {
      const item=await sound.iterator.next(); sound.done=item.done;
      if (item.done) { sound.current=null; return; }
      const sample=item.value;
      try {
        if (sample.sampleRate!==rate || sample.numberOfChannels>2) throw new Error('Prototype audio must be 48 kHz mono/stereo. Resampling is not implemented.');
        const pcm=new Float32Array(sample.numberOfFrames*sample.numberOfChannels);
        sample.copyTo(pcm,{planeIndex:0,format:'f32'});
        sound.current={pcm,channels:sample.numberOfChannels,start:sample.timestamp,end:sample.timestamp+sample.duration,frames:sample.numberOfFrames};
      } finally { sample.close(); }
    }
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{alpha:false});
    // Shape text once, then reuse exactly the same raster for every frame.
    const textLayout=overlayLayout(ctx,config.text,config.textPosition,config.textStyle);
    const textCanvas=new OffscreenCanvas(textLayout.width,textLayout.height),textCtx=textCanvas.getContext('2d');
    paintOverlay(textCtx,config.text,textLayout);
    const root=await navigator.storage.getDirectory();
    destination=await root.getFileHandle(data.outputName,{create:true});
    const writable=await destination.createWritable();
    output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(writable,{chunked:true,chunkSize:1024*1024})});
    const video=new CanvasSource(canvas,{codec:'avc',bitrate:6_000_000,keyFrameInterval:2,latencyMode:'quality',onEncoderConfig:c=>{metrics.videoEncoderConfig=c;}});
    const audio=new AudioSampleSource({codec:'aac',bitrate:128_000,onEncodedPacket:packet=>{
      metrics.audioPacketCount=(metrics.audioPacketCount||0)+1;
      metrics.audioFirstPacketTimestamp??=packet.timestamp;
      metrics.audioLastPacketEnd=packet.timestamp+packet.duration;
    }});
    output.addVideoTrack(video,{frameRate:fps});output.addAudioTrack(audio);await output.start();
    function draw(source,x,y,w,h) {
      const scale=Math.max(w/source.width,h/source.height);
      const sw=w/scale,sh=h/scale;
      ctx.drawImage(source,(source.width-sw)/2,(source.height-sh)/2,sw,sh,x,y,w,h);
    }
    for (let i=0;i<frameCount;i++) {
      if (cancelled) throw new Error('Cancelled');
      const t=i/fps; const a=(await mainFrames.next()).value;
      if (!a) throw new Error(`No main frame at ${t.toFixed(3)}s`);
      const active=t>=config.reactionStart && t<config.reactionStart+reactionDuration;
      const b=active?(await reactionFrames.next()).value:null;
      if (active && !b) throw new Error(`No reaction frame at ${t.toFixed(3)}s`);
      ctx.fillStyle='#050806';ctx.fillRect(0,0,width,height);
      if (b && config.layout==='stack') {draw(a.canvas,0,0,width,height/2);draw(b.canvas,0,height/2,width,height/2);}
      else if (b && config.layout==='side') {draw(a.canvas,0,0,width/2,height);draw(b.canvas,width/2,0,width/2,height);}
      else {draw(a.canvas,0,0,width,height);if(b)draw(b.canvas,690,1100,330,587);}
      if(config.text)ctx.drawImage(textCanvas,textLayout.x-textLayout.width/2,textLayout.y-textLayout.height/2);
      const mix=new Float32Array(block*2);
      for (const sound of sounds) {
        for(let j=0;j<block;j++) {
          const local=t+j/rate-sound.offset;
          if(local<0 || local>=sound.length)continue;
          while(!sound.done && (!sound.current || local>=sound.current.end-1e-9))await advance(sound);
          const c=sound.current;if(!c || local<c.start)continue;
          const frame=Math.min(c.frames-1,Math.max(0,Math.floor((local-c.start)*rate+1e-6)));
          mix[j*2]+=c.pcm[frame*c.channels]*sound.gain;
          mix[j*2+1]+=c.pcm[frame*c.channels+(c.channels===2?1:0)]*sound.gain;
        }
      }
      for(let j=0;j<mix.length;j++){if(Math.abs(mix[j])>1)metrics.clippedAudioSamples++;mix[j]=Math.max(-1,Math.min(1,mix[j]));}
      const sample=new AudioSample({data:mix,format:'f32',numberOfChannels:2,sampleRate:rate,timestamp:t});
      try{await audio.add(sample);}finally{sample.close();}
      await video.add(t,1/fps);metrics.videoFrames++;
      if(i%15===0){
        if(performance.memory)metrics.workerHeapPeakBytes=Math.max(metrics.workerHeapPeakBytes||0,performance.memory.usedJSHeapSize);
        postMessage({type:'progress',progress:100*(i+1)/frameCount,elapsedMs:performance.now()-started});
      }
    }
    video.close();audio.close();await output.finalize();output=null;
    const file=await destination.getFile();
    postMessage({type:'done',file,metrics:{...metrics,durationSeconds:frameCount/fps,exportMs:performance.now()-started,outputBytes:file.size,audioLayers:sounds.length,layout:config.layout,output:'H.264/AAC 1080x1920 30fps',outputStorage:'OPFS streamed, 1 MiB write chunks',inputBytes:Object.values(files).reduce((sum,file)=>sum+(file?.size||0),0)}});
  }catch(error){
    if(output)await output.cancel().catch(()=>{});
    await (await navigator.storage.getDirectory()).removeEntry(data.outputName).catch(()=>{});
    postMessage({type:cancelled?'cancelled':'error',message:error.message});
  }finally{
    await Promise.allSettled(iterators.map(iterator=>iterator.return()));
    for(const input of inputs)input.dispose();
  }
};
