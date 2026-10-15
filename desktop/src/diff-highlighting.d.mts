import type { DiffLine } from "./diff-lines.mjs";
export const MAX_HIGHLIGHT_CHARACTERS: number;
export interface SyntaxToken {
  text: string;
  className: string;
}
export interface HighlightedDiff {
  language: string | null;
  rows: SyntaxToken[][];
  highlighted: boolean;
  reason:
    "unknown-language" | "shortened-line" | "too-large" | "unavailable" | null;
}
export function languageForFilename(filename: string): string | null;
export function highlightDiffLines(
  filename: string,
  rows: DiffLine[],
): HighlightedDiff;
