---
name: library-access
description: Map and scan the installed ameno-/lib library locally, then pull one skill, agent, or assistant. Use when a needed skill is not in the default Acidbath roster, or when the user says scan the library / pull a skill / what skills do we have.
---

# Library access (Acidbath)

Canonical scanner and map live in `~/dev/lib`:

- Map: `~/dev/lib/MAP.md`
- Skill: `~/dev/lib/skills/library-access/`
- Scan: `python3 ~/dev/lib/skills/library-access/scripts/scan.py`

In Acidbath:

```text
/skills list
/skills scan [query]
/skills pull <name>
```

Do not ingest the whole library. Scan, pick one, pull that path.
