import { describe, expect, it } from "vitest";

import { formatJson, renderTable } from "../output";

describe("formatJson", () => {
  it("pretty-prints with two-space indentation", () => {
    expect(formatJson({ a: 1, b: ["x"] })).toBe(
      '{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}',
    );
  });

  it("preserves the exact data shape without reordering keys", () => {
    // Machine-readable mode must echo the API payload verbatim.
    const payload = { workspaces: [{ id: "ws_1", name: "Acme", slug: "acme" }] };
    expect(JSON.parse(formatJson(payload))).toEqual(payload);
  });
});

describe("renderTable", () => {
  it("aligns columns to their widest cell and trims trailing space", () => {
    const table = renderTable(
      ["ID", "NAME"],
      [
        ["a", "Alpha"],
        ["bb", "B"],
      ],
    );

    expect(table).toBe(["ID  NAME", "a   Alpha", "bb  B"].join("\n"));
  });

  it("renders the header row alone when there are no data rows", () => {
    expect(renderTable(["ID", "NAME"], [])).toBe("ID  NAME");
  });

  it("widens a column to fit a header longer than every cell", () => {
    const table = renderTable(["PLATFORM", "ID"], [["x", "1"]]);
    expect(table).toBe(["PLATFORM  ID", "x         1"].join("\n"));
  });
});
