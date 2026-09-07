import sys, subprocess, json
from pathlib import Path
import numpy as np
root=Path(sys.argv[1]); results=[]
for path in sorted(root.glob('*.mp4')):
    pcm=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-vn','-f','f32le','-ar','48000','-ac','1','-']),dtype='<f4').astype(float)
    frequencies=np.fft.rfftfreq(len(pcm),1/48000); spectrum=np.fft.rfft(pcm); spectrum[(frequencies<580)|(frequencies>740)]=0
    isolated=np.fft.irfft(spectrum,n=len(pcm)); envelope=np.sqrt(np.convolve(isolated**2,np.ones(240)/240,mode='same'))
    peak=float(np.median(envelope[int(1.5*48000):int(3.5*48000)]))
    if path.name=='muted.mp4':
        assert peak<.002,peak
        results.append({'file':path.name,'musicRms':peak});continue
    assert peak>.02, (path.name,peak)
    onset=int(np.flatnonzero(envelope>peak*.5)[0])/48000
    results.append({'file':path.name,'musicRms':peak,'approximateOnsetMs':1000*onset,'delayFromChosenStartMs':1000*(onset-1)})
print(json.dumps({'method':'FFT band 580–740 Hz; 5 ms RMS half-height onset. Approximate diagnostic, not sample-exact acceptance.', 'results':results},indent=2))
