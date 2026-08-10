# Acidbath input prompt options

The editor prompt is a terminal text prefix, not a font or cursor escape sequence.
It must be rendered once on the first input line and use a neutral continuation
prefix on wrapped lines.

## Candidate treatments

| Option | First line | Wrapped lines | Character | Notes |
|---|---|---|---|---|
| Current default | `╰─› ` | `│  ` | Unicode light line + single-angle arrow | Recommended: expressive, compact, no repeated arrows |
| Minimal ASCII | `-> ` | `|  ` | ASCII | Safest across terminals/fonts |
| Heavy command | `└─▶ ` | `│  ` | Heavy arrowhead | Stronger visual weight; wider prompt |
| Dash rail | `—› ` | `  ` | Dash + arrow | Calm and compact; less hierarchical |
| Box rail | `╭─› ` | `│  ` | Box-drawing | Feels like a command palette; slightly busier |
| Shell-like | `λ ` | `·  ` | Lambda | Distinctive, but less obviously actionable |

The current implementation uses `╰─› ` for the first line and `│  ` for
continuations. The important invariant is that continuation lines never repeat
the arrow or caret.

## Font boundary

A Pi extension cannot load a terminal font. Iosevka must be selected in the
terminal profile (Ghostty, Kitty, WezTerm, iTerm2, etc.). Acidbath can remain
font-agnostic by using ordinary Unicode/ASCII fallbacks and width-safe TUI
measurement. A future font guide can document an Iosevka profile once the
terminal and variant (for example, SS05 or Term) are chosen.
