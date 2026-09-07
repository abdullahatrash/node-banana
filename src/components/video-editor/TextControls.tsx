import type { TextOverlay } from '@/lib/video-editor/composition';
import type { EditorCopy } from './copy';
export function TextControls({ value, onChange, copy }: { value: TextOverlay; onChange(value: TextOverlay | null): void; copy: EditorCopy }) {
 return <><h2>{copy.text}</h2>
  <label>{copy.overlayText}<textarea aria-label={copy.overlayText} rows={4} dir="auto" maxLength={1000} value={value.text} onChange={event => onChange({ ...value, text: event.target.value })} /></label>
  <label>{copy.align}<select value={value.align} onChange={event => onChange({ ...value, align: event.target.value as TextOverlay['align'] })}>{(['left', 'center', 'right'] as const).map(align => <option key={align} value={align}>{copy.alignment[align]}</option>)}</select></label>
  <label>{copy.weight}<select value={value.fontWeight} onChange={event => onChange({ ...value, fontWeight: Number(event.target.value) as TextOverlay['fontWeight'] })}>{([100, 300, 400, 700] as const).map(weight => <option key={weight} value={weight}>{copy.weights[weight]}</option>)}</select></label>
  <label>{copy.size}<input type="range" min={24} max={160} value={value.fontSize} onChange={event => onChange({ ...value, fontSize: Number(event.target.value) })} /></label>
  <label>{copy.textColor}<input type="color" value={value.color} onChange={event => onChange({ ...value, color: event.target.value })} /></label>
  <label>{copy.backgroundColor}<input type="color" value={value.backgroundColor} onChange={event => onChange({ ...value, backgroundColor: event.target.value })} /></label>
  <label>{copy.opacity}<input type="range" min={0} max={1} step={0.05} value={value.backgroundOpacity} onChange={event => onChange({ ...value, backgroundOpacity: Number(event.target.value) })} /></label>
  <p>{copy.textHelp}</p><button onClick={() => onChange(null)}>{copy.remove}</button>
 </>;
}
