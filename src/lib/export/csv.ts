/**
 * Shared CSV export helpers. Originally lived only in the broadcast
 * detail page; pulled out so Contacts and Reports can reuse the exact
 * same RFC 4180 quoting and download mechanics instead of each
 * re-implementing it.
 */

/** RFC 4180 quoting — quote every field so commas/newlines/quotes round-trip cleanly. */
export function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

export function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
