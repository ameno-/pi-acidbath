#!/usr/bin/env python3
"""Beads CLI — lightweight local issue tracker for .beads/issues.jsonl.

Usage:
    ./beads.py list                          # show all beads
    ./beads.py show bd-acid003               # show one bead
    ./beads.py update bd-acid002 --status in_progress
    ./beads.py update bd-acid002 --status closed
    ./beads.py graph                         # dependency graph
    ./beads.py frontier                       # ready-to-work beads (unblocked + open)
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

BEADS_DIR = Path(__file__).parent
BEADS_FILE = BEADS_DIR / "issues.jsonl"

STATUS_ICON = {"open": "○", "in_progress": "◉", "closed": "✓"}
PRIORITY_COLOR = {"P1": "🔴", "P2": "🟡", "P3": "🟢", "P4": "⚪", "P5": "⚪"}


def load():
    beads = []
    if BEADS_FILE.exists():
        with open(BEADS_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    beads.append(json.loads(line))
    return beads


def save(beads):
    with open(BEADS_FILE, "w") as f:
        for b in beads:
            f.write(json.dumps(b, ensure_ascii=False, separators=(",", ":")) + "\n")


def find(beads, bead_id):
    for b in beads:
        if b["id"] == bead_id:
            return b
    return None


def cmd_list(args):
    beads = load()
    status_filter = None
    label_filter = None
    if args:
        for a in args:
            if a.startswith("--status="):
                status_filter = a.split("=", 1)[1]
            if a.startswith("--label="):
                label_filter = a.split("=", 1)[1]

    for b in beads:
        if status_filter and b["status"] != status_filter:
            continue
        if label_filter and label_filter not in b.get("labels", []):
            continue

        icon = STATUS_ICON.get(b["status"], "○")
        pri = PRIORITY_COLOR.get(b.get("priority", "P4"), "⚪")
        plane = f" [{b.get('plane_ref','')}]" if b.get("plane_ref") else ""
        blocked = " 🔒" if b.get("blocked_by") else ""
        print(f"  {icon} {b['id']}{plane}: {b['title']} {pri}{blocked}")


def cmd_show(args):
    if not args:
        print("usage: show <bead-id>")
        return
    beads = load()
    b = find(beads, args[0])
    if not b:
        print(f"bead {args[0]} not found")
        return
    icon = STATUS_ICON.get(b["status"], "○")
    print(f"{icon} {b['id']} [{b['status']}]")
    print(f"  Title:    {b['title']}")
    print(f"  Priority: {b.get('priority', '-')}")
    print(f"  Labels:   {', '.join(b.get('labels', []))}")
    print(f"  Linear:   {b.get('linear_ref', '-')}")
    print(f"  Plane:    {b.get('plane_ref', '-')} (legacy)")
    if b.get("parent"):
        parent = find(beads, b["parent"])
        pname = parent["title"] if parent else b["parent"]
        print(f"  Parent:   {b['parent']} ({pname})")
    if b.get("blocks"):
        print(f"  Blocks:   {', '.join(b['blocks'])}")
    if b.get("blocked_by"):
        print(f"  Blocked By: {', '.join(b['blocked_by'])}")
    print(f"  Desc:     {b.get('description', '')}")


def cmd_update(args):
    if len(args) < 1:
        print("usage: update <bead-id> [--status <s>] [--priority <p>]")
        return
    bead_id = args[0]
    kwargs = {}
    for a in args[1:]:
        if a.startswith("--status="):
            kwargs["status"] = a.split("=", 1)[1]
        elif a.startswith("--priority="):
            kwargs["priority"] = a.split("=", 1)[1]

    beads = load()
    b = find(beads, bead_id)
    if not b:
        print(f"bead {bead_id} not found")
        return

    changed = False
    for key, val in kwargs.items():
        if b.get(key) != val:
            b[key] = val
            changed = True

    if changed:
        b["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        save(beads)
        icon = STATUS_ICON.get(b["status"], "○")
        print(f"{icon} {b['id']}: updated ({', '.join(f'{k}={v}' for k,v in kwargs.items())})")
    else:
        print(f"{bead_id}: no changes")


def cmd_graph(args):
    beads = load()
    print("Dependency Graph:")
    print()
    for b in beads:
        icon = STATUS_ICON.get(b["status"], "○")
        deps = ""
        if b.get("blocked_by"):
            deps = f"  ← [{', '.join(b['blocked_by'])}]"
        if b.get("blocks"):
            deps += f"  → [{', '.join(b['blocks'])}]"
        print(f"  {icon} {b['id']}{deps}")
        print(f"      {b['title']}")

    print()
    print("Legend:")
    print("  ◉ in_progress  ○ open  ✓ closed")
    print("  🔒 blocked (has unmet dependencies)")


def cmd_frontier(args):
    beads = load()

    # Build set of all bead ids
    all_ids = {b["id"] for b in beads}

    frontier = []
    blocked = []
    in_progress = []
    closed = []

    for b in beads:
        if b["status"] == "closed":
            closed.append(b)
            continue
        if b["status"] == "in_progress":
            in_progress.append(b)
            continue

        # Check if blocked
        is_blocked = False
        for dep_id in b.get("blocked_by", []):
            dep = find(beads, dep_id)
            if dep and dep["status"] != "closed":
                is_blocked = True
                break

        if is_blocked:
            blocked.append(b)
        else:
            frontier.append(b)

    print("=== FRONTIER (ready to work) ===")
    for b in frontier:
        ref = b.get("linear_ref") or b.get("plane_ref") or ""
        if ref: ref = f" [{ref}]"
        print(f"  ○ {b['id']}{ref}: {b['title']}")
    print()

    print("=== IN PROGRESS ===")
    for b in in_progress:
        ref = b.get("linear_ref") or b.get("plane_ref") or ""
        if ref: ref = f" [{ref}]"
        print(f"  ◉ {b['id']}{ref}: {b['title']}")
    print()

    print("=== BLOCKED ===")
    for b in blocked:
        ref = b.get("linear_ref") or b.get("plane_ref") or ""
        if ref: ref = f" [{ref}]"
        deps = ', '.join(b.get('blocked_by', []))
        print(f"  🔒 {b['id']}{ref}: {b['title']} (needs: {deps})")
    print()

    print(f"Frontier: {len(frontier)}  In Progress: {len(in_progress)}  Blocked: {len(blocked)}  Closed: {len(closed)}")


if __name__ == "__main__":
    cmds = {"list": cmd_list, "show": cmd_show, "update": cmd_update, "graph": cmd_graph, "frontier": cmd_frontier}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(1)
    cmds[sys.argv[1]](sys.argv[2:])
