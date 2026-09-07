"""Compare exported collage frames against independent FFmpeg crop/scale references."""
import json, subprocess, sys
from pathlib import Path
import numpy as np
output=Path(sys.argv[1]); fixtures=Path(sys.argv[2]); results=[]
def frame(path,time,width,height):
    data=subprocess.check_output(['ffmpeg','-v','error','-ss',str(time),'-i',str(path),'-frames:v','1','-vf',f'scale={width}:{height}:force_original_aspect_ratio=increase:in_color_matrix=bt709,crop={width}:{height}','-f','rawvideo','-pix_fmt','rgb24','-'])
    return np.frombuffer(data,dtype=np.uint8).reshape(height,width,3)
for layout in ['stacked','pip','side-by-side']:
 for time in [6.5,22]:
    actual=frame(output/f'{layout}.mp4',time,108,192).astype(float)
    expected=frame(fixtures/'main.mp4',time,108,192).astype(float)
    if time<20:
      if layout=='stacked':
        expected[:96]=frame(fixtures/'reaction.mp4',time-5,108,96);expected[96:]=frame(fixtures/'main.mp4',time,108,96)
      elif layout=='side-by-side':
        expected[:,:54]=frame(fixtures/'main.mp4',time,54,192);expected[:,54:]=frame(fixtures/'reaction.mp4',time-5,54,192)
      else: expected[8:75,66:104]=frame(fixtures/'reaction.mp4',time-5,38,67)
    mask=np.ones((192,108),dtype=bool);mask[120:,:]=False # exclude creator-positioned text from the independent framing check
    difference=float(np.abs(actual-expected)[mask].mean())
    assert difference<12,(layout,time,difference)
    results.append({'layout':layout,'time':time,'meanAbsoluteRgbError':difference})
print(json.dumps(results,indent=2))
