import { redirect } from "next/navigation";

/**
 * Legacy route — kept only to preserve bookmarks. The Simple Studio now lives
 * at `/simple-studio/*` with a sidebar shell + dedicated routes per mode.
 */
export default function LegacySimpleStudioRedirect() {
  redirect("/simple-studio/images");
}
