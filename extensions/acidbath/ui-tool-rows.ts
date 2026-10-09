/**
 * Pure, status-first tool-row formatting.
 * Collapsed rows stay one line: a mark, the tool name, the target, and facts.
 * No per-tool faces. Opening a row is Pi's expand affordance, not a label.
 */

export type ToolRowStatus = "pending" | "success" | "error";

export interface ToolRowFormatInput {
  width: number;
  statusGlyph: string;     // short status mark, or empty for the text fallback
  toolGlyph: string;       // unused; tool name is the identity
  toolName: string;
  target: string;
  status: ToolRowStatus;
  metadata?: readonly string[];
  expandable?: boolean;
  expanded?: boolean;
}

export function formatToolRow(input: ToolRowFormatInput): string {
  const width = Math.max(1, Math.trunc(input.width));
  const status = input.statusGlyph || glyphForStatus(input.status);
  const tool = clean(input.toolName) || "tool";
  const target = clean(input.target) || "?";
  const required = `${status} ${tool}  ${target}`;
  const metadata = [...(input.metadata ?? [])].map(clean).filter(Boolean);
  if (input.expandable && input.expanded) metadata.push("open");
  return truncate(metadata.length === 0 ? required : `${required}  ${metadata.join(" · ")}`, width);
}

/** Plain status when color marks are unavailable. Fixed width keeps columns aligned. */
function glyphForStatus(status: ToolRowStatus): string {
  return status === "success" ? "ok " : status === "error" ? "err" : "run";
}

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, width: number): string {
  if (toolRowVisibleWidth(value) <= width) return value;
  if (width <= 1) return "…";
  let output = "";
  let used = 0;
  for (const character of Array.from(value)) {
    const next = characterWidth(character);
    if (used + next > width - 1) break;
    output += character;
    used += next;
  }
  return `${output}…`;
}

export function toolRowVisibleWidth(value: string): number {
  let width = 0;
  for (const character of Array.from(value)) width += characterWidth(character);
  return width;
}

function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
  // Most kaomoji characters (katakana, hiragana, CJK) are fullwidth
  if (codePoint >= 0x3040 && codePoint <= 0x9fff) return 2;
  if (codePoint >= 0x3000 && codePoint <= 0x303f) return 2;
  if (codePoint >= 0xff00 && codePoint <= 0xffef) return 2;
  if (codePoint >= 0x1f300 && codePoint <= 0x1faff) return 2;
  return 1;
}
