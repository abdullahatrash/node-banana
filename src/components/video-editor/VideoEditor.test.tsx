import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoEditor } from "./VideoEditor";
const exporter = vi.hoisted(() => vi.fn());

vi.mock("@/lib/video-editor/export-client", () => ({
  exportComposition: exporter,
}));
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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

it("splits, deletes and undoes individual sections, then reopens the cut and selected typeface for export", async () => {
  const view = render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  await screen.findByLabelText("Trim end");
  for (const time of [3, 6]) {
    fireEvent.change(screen.getByLabelText("Timeline", { exact: true }), {
      target: { value: String(time) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));
  }
  expect(
    screen.getAllByRole("button", { name: /Main video section/ }),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Main video section 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.getAllByRole("button", { name: /Main video section/ }),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(
    screen.getAllByRole("button", { name: /Main video section/ }),
  ).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  fireEvent.change(screen.getByLabelText("Typeface"), {
    target: { value: "naskh" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  view.unmount();
  render(<VideoEditor locale="en" initialId="piece" />);
  await screen.findByLabelText("Trim end");
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  expect(screen.getByLabelText("Typeface")).toHaveValue("naskh");
  fireEvent.click(screen.getByRole("button", { name: "Export video" }));
  await screen.findByRole("link", { name: "Download video" });
  expect(exporter.mock.calls[0][0].main.segments).toEqual([
    { trimStart: 0, trimEnd: 3 },
    { trimStart: 6, trimEnd: 10 },
  ]);
  expect(exporter.mock.calls[0][0].text.fontFamily).toBe("naskh");
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

it("saves a whitespace-normalized title once and gives asset links a reopenable draft URL", async () => {
  window.history.replaceState(null, "", "/editor/main");
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  await screen.findByLabelText("Trim end");
  fireEvent.change(screen.getByLabelText("Video name"), {
    target: { value: "Campaign " },
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  let writes = 0;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "/api/video-editor" && init?.method === "POST" && ++writes > 1)
      throw new Error("Unexpected repeated save");
    return original(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  expect(writes).toBe(1);
  expect(window.location.pathname).toBe("/editor");
  expect(new URLSearchParams(window.location.search).get("piece")).toBe(
    "piece",
  );
});

it("keeps the old media playable when undoing a conflict reload with a different source", async () => {
  render(<VideoEditor locale="en" />);
  fireEvent.click(await screen.findByRole("button", { name: /Phone footage/ }));
  fireEvent.change(await screen.findByLabelText("Trim end"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved");
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).startsWith("/api/video-editor"))
      return init?.method === "POST"
        ? Response.json(
            { success: false, code: "EDITOR_SAVE_CONFLICT" },
            { status: 409 },
          )
        : Response.json({
            success: true,
            records: [
              {
                id: "piece",
                revision: 2,
                composition: {
                  version: 1,
                  title: "Remote edit",
                  main: {
                    assetId: "other",
                    trimStart: 0,
                    trimEnd: 8,
                    start: 0,
                    gain: 1,
                    muted: false,
                  },
                },
              },
            ],
          });
    if (url === "/api/studio/assets/other")
      return Response.json({
        success: true,
        asset: {
          type: "video",
          durationSeconds: 10,
          width: 1080,
          height: 1920,
        },
      });
    return original(url, init);
  });
  fireEvent.change(screen.getByLabelText("Trim end"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Reload saved version" }));
  await waitFor(() => expect(screen.getByLabelText("Trim end")).toHaveValue(8));
  await waitFor(() => expect(screen.getByLabelText("Trim end")).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByLabelText("Trim end")).toHaveValue(4);
  expect(screen.getByLabelText("Main video")).toHaveAttribute(
    "src",
    "https://media.example/main.mp4",
  );
  fireEvent.click(screen.getByRole("button", { name: "Export video" }));
  await screen.findByRole("link", { name: "Download video" });
});
