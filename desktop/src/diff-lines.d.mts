export const MAX_DIFF_ROWS: number;
export const MAX_DIFF_LINE_LENGTH: number;
export interface DiffLine {
  kind: "hunk" | "addition" | "deletion" | "context" | "meta";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  truncated: boolean;
}
export interface ParsedDiff {
  rows: DiffLine[];
  hasMoreLines: boolean;
  shortenedLines: number;
}
export function parseUnifiedDiff(
  patch: string,
  options?: { maxRows?: number; maxLineLength?: number },
): ParsedDiff;
