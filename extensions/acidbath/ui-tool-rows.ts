/**
 * Pure, status-first tool-row formatting with kaomoji glyphs.
 * No Pi/TUI/runtime dependencies.
 */

export type ToolRowStatus = "pending" | "success" | "error";

export interface ToolRowFormatInput {
  width: number;
  statusGlyph: string;     // kaomoji for status state
  toolGlyph: string;       // kaomoji for tool
  toolName: string;        // fallback name
  target: string;
  status: ToolRowStatus;
  metadata?: readonly string[];
  expandable?: boolean;
  expanded?: boolean;
}

export function formatToolRow(input: ToolRowFormatInput): string {
  const width = Math.max(1, Math.trunc(input.width));
  const status = input.statusGlyph || glyphForStatus(input.status);
  const tool = input.toolGlyph || clean(input.toolName) || "tool";
  const target = clean(input.target) || "?";
  // Kaomoji format: "(glyph) (tool) target" — separator between glyphs
  // Text fallback: "ok  tool target" — padding built into status text
  const usingKaomoji = Boolean(input.statusGlyph && input.toolGlyph);
  const required = usingKaomoji
    ? `${status} ${tool} ${target}`
    : `${status}${tool} ${target}`;
  const metadata = [...(input.metadata ?? [])].map(clean).filter(Boolean);
  if (input.expandable && !input.expanded) metadata.push("expand");
  return truncate(metadata.length === 0 ? required : `${required} (${metadata.join(", ")})`, width);
}

/** NO_COLOR fallback: plain text status when kaomoji not available. */
function glyphForStatus(status: ToolRowStatus): string {
  // Keep the original fixed-width (4-char) text labels for backward compat
  return status === "success" ? "ok  " : status === "error" ? "ERR " : "run ";
}

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, width: number): string {
  if (toolRowVisibleWidth(value) <= width) return value;
  if (width <= 1) return "…";
  let output = "";
  for (const character of Array.from(value)) {
    if (toolRowVisibleWidth(output) + characterWidth(character) > width - 1) break;
    output += character;
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
