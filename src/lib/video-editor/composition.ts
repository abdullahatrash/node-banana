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
  secondary: clipSchema.nullable().default(null),
  layout: z.literal('stacked').default('stacked'),
}).strict().superRefine((composition, context) => {
  if (composition.secondary && (clipDuration(composition.secondary) > 15 || composition.secondary.start + clipDuration(composition.secondary) > duration(composition) + 1e-6)) context.addIssue({ code: 'custom', path: ['secondary'], message: 'Secondary video must fit the composition and last at most 15 seconds' });
  if (composition.main && (composition.main.start !== 0 || duration(composition) > MAX_DURATION)) {
    context.addIssue({ code: 'custom', path: ['main'], message: 'The main video starts at zero and lasts at most 60 seconds' });
  }
});
export type Clip = z.infer<typeof clipSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type MediaRole = 'main' | 'secondary';
export const roles: MediaRole[] = ['main', 'secondary'];
export function duration(composition: { main: { trimEnd: number; trimStart: number } | null }) {
  return composition.main ? composition.main.trimEnd - composition.main.trimStart : 0;
}
export function emptyComposition(title = 'Untitled video'): Composition { return { version: 1, title, main: null, secondary: null, layout: 'stacked' }; }
export function createClip(assetId: string, seconds: number): Clip {
  return { assetId, trimStart: 0, trimEnd: Math.min(seconds, MAX_DURATION), start: 0, gain: 1, muted: false };
}
export interface EditorRecord { id: string; revision: number; composition: Composition }
export interface EditorMedia { id: string; name: string; type: 'video' | 'audio'; duration: number; width: number; height: number; url: string }

export function clipDuration(clip: Clip) { return clip.trimEnd - clip.trimStart; }
export function clipActive(clip: Clip | null, time: number) { return Boolean(clip && time >= clip.start && time < clip.start + clipDuration(clip)); }
export type Rect = { x: number; y: number; width: number; height: number };
/** Normalized geometry shared by preview and export. Center crop each panel. */
export function videoRects(_layout: Composition['layout'], secondaryActive: boolean): { main: Rect; secondary: Rect | null } {
 return secondaryActive ? { main: { x: 0, y: 0.5, width: 1, height: 0.5 }, secondary: { x: 0, y: 0, width: 1, height: 0.5 } } : { main: { x: 0, y: 0, width: 1, height: 1 }, secondary: null };
}
