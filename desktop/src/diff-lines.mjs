export const MAX_DIFF_ROWS = 1_200;
export const MAX_DIFF_LINE_LENGTH = 2_000;

export function parseUnifiedDiff(
  patch,
  { maxRows = MAX_DIFF_ROWS, maxLineLength = MAX_DIFF_LINE_LENGTH } = {},
) {
  if (typeof patch !== "string")
    throw new TypeError("A text patch is required.");
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    !Number.isSafeInteger(maxLineLength) ||
    maxLineLength < 1
  ) {
    throw new RangeError("Diff preview limits must be positive integers.");
  }
  const rows = [];
  let position = 0;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let shortenedLines = 0;
  while (position < patch.length && rows.length < maxRows) {
    const newline = patch.indexOf("\n", position);
    const boundary = newline < 0 ? patch.length : newline;
    const end =
      boundary > position && patch[boundary - 1] === "\r"
        ? boundary - 1
        : boundary;
    // Only copy the visible portion, even when a generated line is megabytes long.
    const prefix = patch.slice(
      position,
      Math.min(end, position + Math.max(maxLineLength + 1, 160)),
    );
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(prefix);
    let kind = "meta";
    let oldNumber = null;
    let newNumber = null;
    let markerLength = 0;
    if (hunk) {
      const offsets = [
        Number(hunk[1]),
        Number(hunk[2] ?? 1),
        Number(hunk[3]),
        Number(hunk[4] ?? 1),
      ];
      if (offsets.every(Number.isSafeInteger)) {
        [oldLine, oldRemaining, newLine, newRemaining] = offsets;
        kind = "hunk";
      } else {
        oldRemaining = newRemaining = 0;
      }
    } else if (prefix[0] === "+" && newRemaining > 0) {
      kind = "addition";
      newNumber = newLine++;
      newRemaining--;
      markerLength = 1;
    } else if (prefix[0] === "-" && oldRemaining > 0) {
      kind = "deletion";
      oldNumber = oldLine++;
      oldRemaining--;
      markerLength = 1;
    } else if (prefix[0] === " " && oldRemaining > 0 && newRemaining > 0) {
      kind = "context";
      oldNumber = oldLine++;
      newNumber = newLine++;
      oldRemaining--;
      newRemaining--;
      markerLength = 1;
    }
    const truncated = end - position - markerLength > maxLineLength;
    if (truncated) shortenedLines++;
    rows.push({
      kind,
      oldLine: oldNumber,
      newLine: newNumber,
      text: patch.slice(
        position + markerLength,
        Math.min(end, position + markerLength + maxLineLength),
      ),
      truncated,
    });
    position = newline < 0 ? patch.length : newline + 1;
  }
  return { rows, hasMoreLines: position < patch.length, shortenedLines };
}
