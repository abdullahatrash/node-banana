import enMessages from "@/i18n/messages/en.json";
import arMessages from "@/i18n/messages/ar.json";

const en = enMessages.videoEditor;
const ar: typeof en = arMessages.videoEditor;
export const editorCopy = { en, ar };
export type EditorCopy = typeof en;
export function errorCopy(error: unknown, copy: EditorCopy): string {
  const [code, role] = (error instanceof Error ? error.message : "").split(":");
  const message =
    copy.errors[code as keyof typeof copy.errors] ||
    copy.errors.EDITOR_REQUEST_FAILED;
  return role && ["main", "secondary", "music", "voiceover"].includes(role)
    ? `${copy[role as "main"]}: ${message}`
    : message;
}
