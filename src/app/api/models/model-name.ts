/**
 * Convert a raw model id (kebab-case or snake_case; dots are preserved) to a
 * title-cased display name.
 */
export function humanize(id: string): string {
  return id
    .split(/[-_]/)
    .map((segment) =>
      segment.length === 0
        ? segment
        : segment[0].toUpperCase() + segment.slice(1),
    )
    .join(" ");
}
