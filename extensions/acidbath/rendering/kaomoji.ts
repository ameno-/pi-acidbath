/**
 * Kaomoji catalog — single ASCII emoticons for status and tool glyphs.
 * No Unicode emoji, no Nerd Font icons. Pure kaomoji throughout.
 */

// ── Status glyphs (settled) ────────────────────────────────────────
export const STATUS_SWAG    = "(⌐■_■)";        // success — sunglasses swag
export const STATUS_TOLDYOU = "(￣▽￣)ノ";      // error — smug pointing "told you"
export const STATUS_GTFO    = "(╯°□°)╯︵ ┻━┻"; // warning — table flip, GTFO
export const STATUS_LUMPY   = "(◕‿◕)";         // pending — gentle lumpy face

// ── Tool glyphs ────────────────────────────────────────────────────
export const TOOL_READ  = "(￣ω￣)";      // peaceful reading
export const TOOL_BASH  = "(ﾟﾍﾟ)";       // intense concentration
export const TOOL_EDIT  = "(｡•̀ᴗ-)✧";    // careful editing
export const TOOL_WRITE = "(✧ω✧)";      // flow state writing
export const TOOL_GREP  = "(｀・ω・´)";   // guinea — small alert animal sniffing
export const TOOL_LS    = "(゜▽゜)";     // looking around directory
export const TOOL_FIND  = "(｀∀´)";      // confident find

// ── Tool animation frames (looped while pending) ───────────────────
// Each tool cycles through these expressions on each clock tick.
// Progressive exhaustion within the loop — not stateful across duration.
export const ANIM_FRAMES: Record<string, readonly string[]> = {
  read:  ["(￣ω￣)", "(￣～￣)"],                 // reading, blinks
  bash:  ["(ﾟﾍﾟ)",  "(ﾟДﾟ)",  "(;ﾟДﾟ)"],       // intense → stressed → frantic → loop
  edit:  ["(｡•̀ᴗ-)✧", "(｡•̀ᴗ-)/", "(；•̀ᴗ-)"],  // editing → raising hand → worried → loop
  write: ["(✧ω✧)", "✧(ω✧)", "(✧_✧)"],          // flow → shifting → lost → loop
  grep:  ["(｀・ω・´)", "(｀・ω・`)",  "(｀ﾟωﾟ´)"],  // alert → searching hard → intense → loop
  ls:    ["(゜▽゜)", "(゜-゜)", "(゜Д゜)"],        // looking → confused → overwhelmed → loop
  find:  ["(｀∀´)",  "(｀・ω・´)", "(｀Д´)"],      // confident → searching → determined → loop
};

// ── Tool-name → glyph map ──────────────────────────────────────────
const TOOL_MAP: Record<string, string> = {
  read:  TOOL_READ,
  bash:  TOOL_BASH,
  edit:  TOOL_EDIT,
  write: TOOL_WRITE,
  grep:  TOOL_GREP,
  ls:    TOOL_LS,
  find:  TOOL_FIND,
};

/** Return the single kaomoji glyph for a tool name. */
export function toolGlyph(toolName: string): string {
  return TOOL_MAP[toolName] ?? toolName.slice(0, 4);
}

/** Return the kaomoji glyph for a status state. */
export function statusGlyph(status: string, settled: boolean): string {
  if (!settled) return STATUS_LUMPY;
  switch (status) {
    case "success": return STATUS_SWAG;
    case "error":   return STATUS_TOLDYOU;
    case "warning": return STATUS_GTFO;
    default:        return STATUS_LUMPY;
  }
}

/** Return the animation frame index for a tool at a given tick. */
export function animFrame(toolName: string, tick: number): string {
  const frames = ANIM_FRAMES[toolName];
  if (!frames || frames.length === 0) return toolGlyph(toolName);
  return frames[tick % frames.length];
}

/** Return animation frame count for a tool (0 = no animation). */
export function animFrameCount(toolName: string): number {
  return ANIM_FRAMES[toolName]?.length ?? 0;
}
