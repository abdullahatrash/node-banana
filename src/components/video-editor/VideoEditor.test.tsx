import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoEditor } from "./VideoEditor";
const exporter = vi.hoisted(() => vi.fn());

vi.mock("@/lib/video-editor/export-client", () => ({
  exportComposition: exporter,
}));
beforeEach(() => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      postMessage() {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { duration: 10, width: 1080, height: 1920 },
          }),
        );
      }
      terminate() {}
    },
  );
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  localStorage.setItem("node-banana-active-workspace-id", "ws");
  let saved: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/video-editor" && init?.method === "POST") {
        const input = JSON.parse(String(init.body));
        const record = {
          id: "piece",
          revision: 1,
          composition: input.composition,
        };
        saved = [record];
        return Response.json({ success: true, record });
      }
      if (url.startsWith("/api/video-editor"))
        return Response.json({ success: true, records: saved });
      if (url.startsWith("/api/product-library/assets"))
        return Response.json({
          success: true,
          items: [
            {
              id: "main",
              name: "Phone footage",
              type: "video",
              durationSeconds: 10,
              width: 1080,
              height: 1920,
            },
          ],
          nextCursor: null,
        });
      if (url === "/api/studio/assets/main")
        return Response.json({
          success: true,
          asset: {
            type: "video",
            durationSeconds: 10,
            width: 1080,
            height: 1920,
            metadata: { originalFileName: "Phone footage" },
          },
        });
      if (url.endsWith("/download"))
        return Response.json({
          success: true,
          downloadUrl: "https://media.example/main.mp4",
        });
      return Response.json({}, { status: 404 });
    }),
  );
  exporter.mockResolvedValue({
    file: new File(["mp4"], "video.mp4", { type: "video/mp4" }),
    release: vi.fn().mockResolvedValue(undefined),
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:export"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
it("selects Workspace footage, saves a trim, reopens, and requests an export of that composition", async () => {
  const view = render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  fireEvent.change(await screen.findByLabelText("Trim end"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  view.unmount();
  render(<VideoEditor locale="en" initialId="piece" />);
  await waitFor(() => expect(screen.getByLabelText("Trim end")).toHaveValue(5));
  fireEvent.click(screen.getByRole("button", { name: "Export video" }));
  await screen.findByRole("link", { name: "Download video" });
  expect(exporter.mock.calls[0][0].main).toMatchObject({
    assetId: "main",
    trimStart: 0,
    trimEnd: 5,
  });
});

it("retains the selected trim after a quota denial and allows another upload attempt", async () => {
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  fireEvent.change(await screen.findByLabelText("Trim end"), {
    target: { value: "5" },
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url).endsWith("/presign")
      ? Response.json({ success: false }, { status: 403 })
      : original(url, init),
  );
  fireEvent.change(screen.getByLabelText("Upload video or audio"), {
    target: { files: [new File(["test"], "phone.mp4", { type: "video/mp4" })] },
  });
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Trim end")).toHaveValue(5);
  expect(screen.getByLabelText("Upload video or audio")).toBeEnabled();
});

it("edits multiline Arabic text through properties and the video overlay", async () => {
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: "Add text" }));
  fireEvent.change(screen.getByLabelText("Overlay text"), {
    target: { value: "مرحبا بالعالم\nHello 2026" },
  });
  fireEvent.doubleClick(
    screen.getByRole("button", { name: "Move or edit text" }),
  );
  const inline = screen.getByLabelText("Edit text on video");
  expect(inline).toHaveValue("مرحبا بالعالم\nHello 2026");
  fireEvent.change(inline, { target: { value: "السطر الأول\nالسطر الثاني" } });
  fireEvent.keyDown(inline, { key: "Enter", ctrlKey: true });
  expect(screen.getByLabelText("Overlay text")).toHaveValue(
    "السطر الأول\nالسطر الثاني",
  );
});

it("undoes a grouped edit and preserves it after a stale-revision save fails", async () => {
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  fireEvent.change(await screen.findByLabelText("Trim end"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  fireEvent.change(screen.getByLabelText("Trim end"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByLabelText("Trim end")).toHaveValue(5);
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url) === "/api/video-editor" && init?.method === "POST"
      ? Response.json(
          { success: false, code: "EDITOR_SAVE_CONFLICT" },
          { status: 409 },
        )
      : original(url, init),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Trim end")).toHaveValue(4);
  expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save a copy" })).toBeEnabled();
});

it("retries an uncertain save with the same key and stays in its original Workspace", async () => {
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  await screen.findByLabelText("Trim end");
  const original = vi.mocked(fetch).getMockImplementation()!;
  let first = true;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (
      String(url) === "/api/video-editor" &&
      init?.method === "POST" &&
      first
    ) {
      first = false;
      throw new Error("connection lost");
    }
    return original(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  localStorage.setItem("node-banana-active-workspace-id", "another-workspace");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  const writes = vi
    .mocked(fetch)
    .mock.calls.filter(
      ([url, init]) => url === "/api/video-editor" && init?.method === "POST",
    );
  expect(writes).toHaveLength(2);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
  expect(new Headers(writes[1][1]?.headers).get("x-workspace-id")).toBe("ws");
});
