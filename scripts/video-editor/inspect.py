"""Inspect real acceptance exports; ffmpeg/ffprobe and numpy required."""
import json, subprocess, sys
import numpy as np
path = sys.argv[1]
metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', path]))
video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
assert (video['width'], video['height'], video['codec_name']) == (1080, 1920, 'h264')
assert abs(float(video['duration']) - 5) < 1/30
pcm = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-f', 'f32le', '-ar', '48000', '-ac', '1', '-']), dtype='<f4')
levels = {}
for start in [0.5, 2.5, 3.5, 4.5]:
    window = pcm[int(start*48000):int((start+.25)*48000)].astype(float)
    t = np.arange(len(window))/48000
    levels[start] = {hz: float(abs(np.sum(window*np.exp(-2j*np.pi*hz*t)))*2/len(window)) for hz in [220, 440, 660, 880]}
assert all(row[220] > .03 for row in levels.values()), levels
assert levels[2.5][440] > .03 and levels[0.5][440] < .01 and levels[4.5][440] < .01, levels
print(json.dumps({'videoDuration': video['duration'], 'frames': video.get('nb_frames'), 'containerAudioDuration': next(s['duration'] for s in metadata['streams'] if s['codec_type'] == 'audio'), 'interiorAudioLevels': levels}, indent=2))

assert all(row[660] > .01 for row in levels.values()), levels
assert levels[3.5][880] > .03 and levels[0.5][880] < .01 and levels[4.5][880] < .01, levels
