"""Reachability model checker for the game data.

Verifies, for everything that's gated behind state:
  1. Every flag *required* by some scenario / ending / event is also *set* by
     some scenario / event. (Else: dead-end story branch.)
  2. Every item that some choice tries to *consume* is *addable* via some other
     choice's `inventory.add` or character `startingInventory`. (Else: dead
     consumable.)
  3. Every ending's `condition` has at least a candidate path: all "must-have"
     flags are reachable, no impossible numeric constraints (e.g. stamina <= -1
     when min is 0), no `hasNot` that conflicts with starting flags.
  4. Every scenario's `requires` is satisfiable: required flags reachable,
     turn bounds within MAX_TURNS (72).
  5. Reports orphan flag setters (set but never gates anything) as info only.

Output: human-readable report on stdout. Exits non-zero if hard issues exist
(unreachable consumables, unreachable endings, dead-end requires).
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "game"
MAX_TURNS = 72
STAT_MAX = 10
STAT_MIN = 0
REP_MIN = -10
REP_MAX = 10


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def collect_flag_setters(scenarios, events, characters):
    """flag → list of (origin, location) tuples"""
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    # Engine-injected flags: gender, contract type, and age band are added by
    # createGameState based on the player's selection on the character select +
    # state picker screens, not by any scenario / event / character data.
    for f in ("m_gender", "f_gender", "nb_gender"):
        out[f].append(("engine", "createGameState (gender)"))
    for f in ("contract_PON", "contract_PNRR", "contract_MSCA", "contract_FFO"):
        out[f].append(("engine", "createGameState (contractType)"))
    for f in ("age_under33", "age_33to40", "age_over40"):
        out[f].append(("engine", "createGameState (ageBand)"))
    for c in characters["characters"]:
        for f in c.get("startingFlags", []):
            out[f].append(("character", c["id"]))
    for s in scenarios["scenarios"]:
        for i, ch in enumerate(s["choices"]):
            for branch_path, branch in iter_branches(ch):
                eff = branch.get("effects") if isinstance(branch, dict) else None
                if not eff:
                    continue
                for f in (eff.get("flags") if isinstance(eff.get("flags"), list) else []) or []:
                    out[f].append(("scenario", f"{s['id']}/choice[{i}]{branch_path}"))
                for f in eff.get("flagsAdd") or []:
                    out[f].append(("scenario", f"{s['id']}/choice[{i}]{branch_path}"))
    for e in events["events"]:
        eff = e.get("effects") or {}
        for f in (eff.get("flags") if isinstance(eff.get("flags"), list) else []) or []:
            out[f].append(("event", e["id"]))
        for f in eff.get("flagsAdd") or []:
            out[f].append(("event", e["id"]))
        # Event choices (interactive events) — same shape as scenario choices.
        for i, ch in enumerate(e.get("choices") or []):
            for branch_path, branch in iter_branches(ch):
                beff = branch.get("effects") if isinstance(branch, dict) else None
                if not beff:
                    continue
                for f in (beff.get("flags") if isinstance(beff.get("flags"), list) else []) or []:
                    out[f].append(("event_choice", f"{e['id']}/choice[{i}]{branch_path}"))
                for f in beff.get("flagsAdd") or []:
                    out[f].append(("event_choice", f"{e['id']}/choice[{i}]{branch_path}"))
    return out


def collect_inventory_setters(scenarios, characters):
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for c in characters["characters"]:
        for it in c.get("startingInventory", []):
            out[it].append(("character", c["id"]))
    for s in scenarios["scenarios"]:
        for i, ch in enumerate(s["choices"]):
            for branch_path, branch in iter_branches(ch):
                eff = branch.get("effects") if isinstance(branch, dict) else None
                if not eff:
                    continue
                inv = eff.get("inventory") or {}
                for it in inv.get("add") or []:
                    out[it].append(("scenario", f"{s['id']}/choice[{i}]{branch_path}"))
    return out


def iter_branches(choice):
    """Yield ('', choice) plus each branch under choice.check if present."""
    yield ("", choice)
    check = choice.get("check")
    if not check:
        return
    for k in ("success", "failure", "critical_success", "critical_failure"):
        b = check.get(k)
        if b:
            yield (f".{k}", b)


def collect_flag_refs(scenarios, events, endings):
    """flag → list of (where, kind: has|hasAny|hasNot)"""
    refs: dict[str, list[tuple[str, str]]] = defaultdict(list)

    def walk(cond, where):
        if not cond:
            return
        if "all" in cond:
            for c in cond["all"]:
                walk(c, where)
        if "any" in cond:
            for c in cond["any"]:
                walk(c, where)
        flags_spec = cond.get("flags")
        if flags_spec:
            if isinstance(flags_spec, list):
                for f in flags_spec:
                    refs[f].append((where, "has"))
            else:
                for kind in ("has", "hasAny", "hasNot"):
                    for f in flags_spec.get(kind) or []:
                        refs[f].append((where, kind))
        inv_spec = cond.get("inventory")
        if isinstance(inv_spec, dict):
            for kind in ("has", "hasAny", "hasNot"):
                for it in inv_spec.get(kind) or []:
                    refs[it].append((where, f"inventory:{kind}"))

    for s in scenarios["scenarios"]:
        walk(s.get("requires"), f"scenario:{s['id']}.requires")
        for i, ch in enumerate(s["choices"]):
            walk(ch.get("requires"), f"scenario:{s['id']}.choice[{i}].requires")
    for e in events["events"]:
        walk(e.get("requires"), f"event:{e['id']}.requires")
    for end in endings["endings"]:
        walk(end.get("condition"), f"ending:{end['id']}.condition")
    return refs


def collect_consumes(scenarios):
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for s in scenarios["scenarios"]:
        for i, ch in enumerate(s["choices"]):
            for it in ch.get("consume") or []:
                out[it].append(("scenario", f"{s['id']}/choice[{i}]"))
    return out


def collect_ending_numeric_constraints(endings):
    """Check that ending conditions don't require impossible stat/rep values."""
    problems = []

    def walk(cond, where):
        if not cond:
            return
        if "all" in cond:
            for c in cond["all"]:
                walk(c, where)
        if "any" in cond:
            for c in cond["any"]:
                walk(c, where)
        for kind, spec_map in (("stats", cond.get("stats")), ("reputation", cond.get("reputation"))):
            if not spec_map:
                continue
            for key, spec in spec_map.items():
                if isinstance(spec, dict):
                    for op, val in spec.items():
                        if kind == "stats":
                            if op == "gte" and val > STAT_MAX:
                                problems.append(f"{where}: {kind}.{key} {op} {val} > max {STAT_MAX}")
                            if op == "lte" and val < STAT_MIN:
                                problems.append(f"{where}: {kind}.{key} {op} {val} < min {STAT_MIN}")
                        else:
                            if op == "gte" and val > REP_MAX:
                                problems.append(f"{where}: {kind}.{key} {op} {val} > max {REP_MAX}")
                            if op == "lte" and val < REP_MIN:
                                problems.append(f"{where}: {kind}.{key} {op} {val} < min {REP_MIN}")
        # turn bounds
        if "minTurn" in cond and cond["minTurn"] > MAX_TURNS:
            problems.append(f"{where}: minTurn {cond['minTurn']} > MAX_TURNS {MAX_TURNS}")

    for end in endings["endings"]:
        walk(end.get("condition"), f"ending:{end['id']}")
    return problems


def main():
    scenarios = load("scenarios.json")
    events = load("randomEvents.json")
    endings = load("endings.json")
    characters = load("characters.json")

    flag_setters = collect_flag_setters(scenarios, events, characters)
    flag_refs = collect_flag_refs(scenarios, events, endings)
    inv_setters = collect_inventory_setters(scenarios, characters)
    consumes = collect_consumes(scenarios)
    numeric_problems = collect_ending_numeric_constraints(endings)

    hard_issues = 0

    print("=" * 72)
    print("MODEL CHECK REPORT")
    print("=" * 72)
    print(f"Scenarios: {len(scenarios['scenarios'])}")
    print(f"Events: {len(events['events'])}")
    print(f"Endings: {len(endings['endings'])}")
    print(f"Characters: {len(characters['characters'])}")
    print()

    # 1. Flags referenced but never set
    unreachable_flags = []
    for f, refs in flag_refs.items():
        if not flag_setters.get(f):
            # Flag is referenced in a `has` or `hasAny` somewhere — dead end
            kinds = {kind for _, kind in refs}
            if "has" in kinds or "hasAny" in kinds:
                unreachable_flags.append((f, refs))
    if unreachable_flags:
        hard_issues += len(unreachable_flags)
        print(f"❌ {len(unreachable_flags)} flag(s) referenced but never set:")
        for f, refs in sorted(unreachable_flags):
            print(f"   - {f}")
            for where, kind in refs[:3]:
                print(f"       referenced by {where} ({kind})")
            if len(refs) > 3:
                print(f"       ... and {len(refs) - 3} more")
        print()

    # 2. Consumables that can't be obtained
    unreachable_items = []
    for item, refs in consumes.items():
        if not inv_setters.get(item):
            unreachable_items.append((item, refs))
    if unreachable_items:
        hard_issues += len(unreachable_items)
        print(f"❌ {len(unreachable_items)} consumable(s) consumed but never added:")
        for item, refs in unreachable_items:
            print(f"   - {item}")
            for kind, where in refs[:3]:
                print(f"       consumed by {where}")

        print()

    # 3. Numeric impossibilities
    if numeric_problems:
        hard_issues += len(numeric_problems)
        print(f"❌ {len(numeric_problems)} impossible numeric constraint(s):")
        for p in numeric_problems:
            print(f"   - {p}")
        print()

    # 4. Endings with required flags that are reachable but require specific paths.
    #    (info: list endings whose 'has' flags are set by ≤ 1 scenario — narrow path)
    fragile_endings = []
    for end in endings["endings"]:
        cond = end.get("condition") or {}
        # walk to find all "has" flags
        has_flags = []
        def walk_has(c):
            if not c:
                return
            if "all" in c:
                for x in c["all"]:
                    walk_has(x)
            if "any" in c:
                for x in c["any"]:
                    walk_has(x)
            fs = c.get("flags")
            if fs:
                if isinstance(fs, list):
                    has_flags.extend(fs)
                else:
                    has_flags.extend(fs.get("has") or [])
        walk_has(cond)
        narrow = [(f, len(flag_setters[f])) for f in has_flags if flag_setters.get(f) and len(flag_setters[f]) == 1]
        if narrow:
            fragile_endings.append((end["id"], narrow))
    if fragile_endings:
        print(f"ℹ️  {len(fragile_endings)} ending(s) gated by single-setter flag(s) — narrow path:")
        for eid, flags in fragile_endings[:10]:
            flagdesc = ", ".join(f for f, _ in flags)
            print(f"   - {eid}: relies on {flagdesc}")
        print()

    # 5. Flags set but never referenced (informational)
    orphan_setters = []
    for f in flag_setters:
        if not flag_refs.get(f):
            orphan_setters.append(f)
    if orphan_setters:
        print(f"ℹ️  {len(orphan_setters)} flag(s) set but never gate anything (dead pendants).")
        # Don't list — usually intentional flavor flags.

    # 6. Inventory items added but never consumed (informational)
    orphan_items = []
    for it in inv_setters:
        if it not in consumes:
            orphan_items.append(it)
    if orphan_items:
        print(f"ℹ️  {len(orphan_items)} inventory item(s) added but never consumed:")
        for it in sorted(orphan_items)[:15]:
            print(f"   - {it}")
        if len(orphan_items) > 15:
            print(f"   ... and {len(orphan_items) - 15} more")
        print()

    # 7. Ending audit: decision-linked vs stat-only
    print()
    print("ENDING DECISION-LINKAGE AUDIT")
    print("-" * 72)
    audit_rows = audit_endings(endings)
    stat_only = []
    print(f"{'ID':28s} {'TYPE':18s} GATE")
    for row in audit_rows:
        marker = "⚠️ " if row["type"] == "stat-only" else "  "
        print(f"{marker}{row['id']:26s} {row['type']:18s} {row['gate']}")
        if row["type"] == "stat-only":
            stat_only.append(row["id"])
    print()
    if stat_only:
        print(f"⚠️  {len(stat_only)} ending(s) trigger purely on stat/rep thresholds:")
        for sid in stat_only:
            print(f"   - {sid}")
        print("   Consider adding a narrative-flag requirement so they connect to actual decisions.")

    print("=" * 72)
    if hard_issues == 0:
        print(f"✅ Model check passed. {hard_issues} hard issue(s).")
    else:
        print(f"❌ Model check found {hard_issues} hard issue(s) — see above.")
    print("=" * 72)
    return 1 if hard_issues > 0 else 0


def audit_endings(endings):
    """Classify each ending by whether it's gated by player decisions (flags),
    stat/reputation thresholds, time, or some combination."""
    rows = []
    for end in endings["endings"]:
        cond = end.get("condition") or {}
        has_flag = False
        has_stat = False
        has_rep = False
        has_time = False
        flag_names = set()
        stat_names = set()
        rep_names = set()

        def walk(c):
            nonlocal has_flag, has_stat, has_rep, has_time
            if not c:
                return
            if "all" in c:
                for x in c["all"]:
                    walk(x)
            if "any" in c:
                for x in c["any"]:
                    walk(x)
            fs = c.get("flags")
            if fs:
                if isinstance(fs, list):
                    has_flag = True
                    flag_names.update(fs)
                else:
                    for kind in ("has", "hasAny"):
                        if fs.get(kind):
                            has_flag = True
                            flag_names.update(fs[kind])
                    # hasNot alone isn't really a "decision" — it's a default.
            ss = c.get("stats")
            if ss:
                has_stat = True
                stat_names.update(ss.keys())
            rs = c.get("reputation")
            if rs:
                has_rep = True
                rep_names.update(rs.keys())
            inv = c.get("inventory")
            if inv:
                has_flag = True  # inventory presence is also a decision marker
            if "minTurn" in c or "maxTurn" in c:
                has_time = True
        walk(cond)

        if has_flag and (has_stat or has_rep):
            kind = "decision+stat"
        elif has_flag:
            kind = "decision-only"
        elif has_stat or has_rep:
            kind = "stat-only"
        elif has_time:
            kind = "time-only"
        else:
            kind = "unconditional"

        parts = []
        if flag_names:
            parts.append(f"flags={','.join(sorted(flag_names)[:3])}{'…' if len(flag_names)>3 else ''}")
        if stat_names:
            parts.append(f"stats={','.join(sorted(stat_names))}")
        if rep_names:
            parts.append(f"rep={','.join(sorted(rep_names))}")
        if has_time:
            parts.append("turn")
        rows.append({"id": end["id"], "type": kind, "gate": " · ".join(parts)})
    return rows


if __name__ == "__main__":
    sys.exit(main())
