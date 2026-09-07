import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
const run = promisify(execFile);
const directory =
  process.env.EDITOR_FIXTURES ||
  join(tmpdir(), "tasmeemai-throwaway-reaction-export-v1");
await mkdir(directory, { recursive: true });
const commands = [
  [
    "main.mp4",
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1080x1920:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:sample_rate=48000",
      "-t",
      "60",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
    ],
  ],
  [
    "reaction.mp4",
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=720x1280:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "15",
      "-vf",
      "hue=h=100",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
    ],
  ],
  [
    "music.wav",
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=48000",
      "-t",
      "60",
      "-ac",
      "2",
    ],
  ],
  [
    "voice.wav",
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "10",
      "-ac",
      "2",
    ],
  ],
  [
    "music-44100.mp3",
    ["-i", join(directory, "music.wav"), "-ar", "44100", "-b:a", "128k"],
  ],
  [
    "music-vbr.mp3",
    ["-i", join(directory, "music.wav"), "-ar", "44100", "-q:a", "3"],
  ],
  [
    "music-mono.mp3",
    [
      "-i",
      join(directory, "music.wav"),
      "-ar",
      "44100",
      "-ac",
      "1",
      "-b:a",
      "128k",
    ],
  ],
  [
    "music-untagged.mp3",
    [
      "-i",
      join(directory, "music.wav"),
      "-ar",
      "44100",
      "-b:a",
      "128k",
      "-write_xing",
      "0",
      "-id3v2_version",
      "0",
    ],
  ],
  ["music-44100.wav", ["-i", join(directory, "music.wav"), "-ar", "44100"]],
  ["voice-24000.wav", ["-i", join(directory, "voice.wav"), "-ar", "24000"]],
];
for (const [name, args] of commands)
  if (!existsSync(join(directory, name)))
    await run(
      "ffmpeg",
      ["-v", "error", "-nostdin", ...args, join(directory, name)],
      { timeout: 180000 },
    );
await writeFile(join(directory, "malformed.mp3"), "not an MP3 file");
console.log(directory);
