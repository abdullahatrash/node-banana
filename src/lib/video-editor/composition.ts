import { z } from 'zod';

export const VIDEO_FPS = 30;
export const MAX_DURATION = 60;
export const clipSchema = z.object({
  assetId: z.string().min(1).max(200),
  trimStart: z.number().finite().min(0).max(86_400),
  trimEnd: z.number().finite().positive().max(86_400),
  start: z.number().finite().min(0).max(MAX_DURATION),
  gain: z.number().finite().min(0).max(1),
  muted: z.boolean(),
}).strict().refine((clip) => clip.trimEnd - clip.trimStart >= 1 / VIDEO_FPS, 'Select at least one frame');

export const compositionSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(240),
  main: clipSchema.nullable(),
}).strict().superRefine((composition, context) => {
  if (composition.main && (composition.main.start !== 0 || duration(composition) > MAX_DURATION)) {
    context.addIssue({ code: 'custom', path: ['main'], message: 'The main video starts at zero and lasts at most 60 seconds' });
  }
});
export type Clip = z.infer<typeof clipSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type MediaRole = 'main';
export const roles: MediaRole[] = ['main'];
export function duration(composition: { main: { trimEnd: number; trimStart: number } | null }) {
  return composition.main ? composition.main.trimEnd - composition.main.trimStart : 0;
}
export function emptyComposition(title = 'Untitled video'): Composition { return { version: 1, title, main: null }; }
export function createClip(assetId: string, seconds: number): Clip {
  return { assetId, trimStart: 0, trimEnd: Math.min(seconds, MAX_DURATION), start: 0, gain: 1, muted: false };
}
export interface EditorRecord { id: string; revision: number; composition: Composition }
export interface EditorMedia { id: string; name: string; type: 'video' | 'audio'; duration: number; width: number; height: number; url: string }
