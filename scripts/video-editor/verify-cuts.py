"""Inspect the real MP4s from editing-check.mjs, independently of the editor model."""
import json, subprocess, sys, hashlib
from pathlib import Path
import numpy as np
out, fixtures = map(Path, sys.argv[1:3])
def frame(path, time, width, height):
    data = subprocess.check_output(['ffmpeg','-v','error','-ss',str(time),'-i',str(path),'-frames:v','1','-vf',f'scale={width}:{height}:force_original_aspect_ratio=increase:in_color_matrix=bt709,crop={width}:{height}','-f','rawvideo','-pix_fmt','rgb24','-'])
    return np.frombuffer(data,dtype=np.uint8).reshape(height,width,3)
results=[]
for font in ['sans','cairo','naskh']:
    path=out/f'{font}.mp4'
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(path)]))
    video=next(s for s in meta['streams'] if s['codec_type']=='video')
    assert video['codec_name']=='h264' and (video['width'],video['height'])==(1080,1920)
    assert abs(float(video['duration'])-7)<.001
    comparisons=[]
    for time in [1.5,4.5]:
        source=time if time<3 else time+3
        actual=frame(path,time,108,192)
        expected=np.concatenate([frame(fixtures/'reaction.mp4',source,108,96),frame(fixtures/'main.mp4',source,108,96)])
        error=float(np.abs(actual[:120].astype(float)-expected[:120].astype(float)).mean())
        assert error<12,(font,time,error)
        comparisons.append({'outputTime':time,'sourceTime':source,'meanRgbError':error})
    audio=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-vn','-ac','1','-ar','48000','-f','f32le','-']),dtype='<f4')
    tones=[]
    for time in [1,4]:
        sample=audio[int(time*48000):int((time+.25)*48000)]
        spectrum=abs(np.fft.rfft(sample*np.hanning(len(sample))))
        frequencies=np.fft.rfftfreq(len(sample),1/48000)
        values={str(f):float(spectrum[abs(frequencies-f)<5].max()) for f in [220,440,660,880]}
        assert all(value>1 for value in values.values()),(font,time,values)
        tones.append({'outputTime':time,'toneEnergy':values})
    text_hash=hashlib.sha256(frame(path,1.5,108,192)[125:175].tobytes()).hexdigest()
    results.append({'font':font,'videoDuration':video['duration'],'frames':comparisons,'audio':tones,'textRegionSha256':text_hash})
assert len({row['textRegionSha256'] for row in results})==3,'Typeface exports should render different text shapes'
print(json.dumps(results,indent=2))
