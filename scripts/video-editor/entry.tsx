// Local acceptance harness: real editor and worker, synthetic Workspace service.
import { createRoot } from "react-dom/client";
import { VideoEditor } from "../../src/components/video-editor/VideoEditor";
localStorage.setItem("node-banana-active-workspace-id", "editor-local-fixture");
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <VideoEditor
    locale={params.get("lang") === "en" ? "en" : "ar"}
    initialId={params.get("piece") || undefined}
  />,
);
