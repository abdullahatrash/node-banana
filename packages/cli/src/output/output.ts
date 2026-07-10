/**
 * Serialize a value as machine-readable JSON for `--json` mode. Two-space
 * indented and key-order-preserving, so CI pipelines see the API payload
 * verbatim.
 */
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Render a fixed-width text table for human (non-`--json`) output.
 *
 * Each column is padded to its widest cell (or its header, whichever is
 * larger); columns are separated by two spaces and trailing whitespace is
 * trimmed per line. With no data rows, only the header row is returned.
 */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) => {
    const cellWidth = rows.reduce(
      (max, row) => Math.max(max, (row[column] ?? "").length),
      0,
    );
    return Math.max(header.length, cellWidth);
  });

  const formatRow = (cells: readonly string[]): string =>
    headers
      .map((_, column) => (cells[column] ?? "").padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}
