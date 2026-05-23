// D&D-style skill check resolution.
//
// Modifier convention: a stat value of 5 is the neutral baseline (+0). Each
// point above/below shifts the modifier by 1. So stat 10 → +5, stat 0 → −5.
// This keeps the math obvious for players: "I have 7 stamina, so +2."
//
// Roll = 1d20 + (stat − 5) + bonus
// Critical success: natural 20 (always succeeds regardless of total)
// Critical failure: natural 1  (always fails  regardless of total)
//
// Check schema:
//   { "stat": "persuasione", "dc": 15, "bonus": 0,
//     "success":          { "effects": {...}, "reaction": {...} },
//     "failure":          { "effects": {...}, "reaction": {...} },
//     "critical_success": { ... },                  // optional, defaults to success
//     "critical_failure": { ... }                   // optional, defaults to failure
//   }
//
// Result kind: "success" | "failure" | "critical_success" | "critical_failure"

const STAT_BASELINE = 5;

export function statModifier(value) {
  return (value ?? 0) - STAT_BASELINE;
}

export function rollCheck(check, state, rng = Math.random) {
  const d20 = Math.floor(rng() * 20) + 1;
  const statValue = state.stats[check.stat] ?? 0;
  const mod = statModifier(statValue);
  const bonus = check.bonus ?? 0;
  const total = d20 + mod + bonus;

  let kind;
  if (d20 === 20) kind = "critical_success";
  else if (d20 === 1) kind = "critical_failure";
  else if (total >= check.dc) kind = "success";
  else kind = "failure";

  return {
    d20,
    stat: check.stat,
    statValue,
    modifier: mod,
    bonus,
    total,
    dc: check.dc,
    kind,
    passed: kind === "success" || kind === "critical_success",
  };
}

export function resolveBranch(check, kind) {
  // critical_* falls back to success/failure if no explicit branch
  if (kind === "critical_success") return check.critical_success ?? check.success ?? null;
  if (kind === "critical_failure") return check.critical_failure ?? check.failure ?? null;
  return check[kind] ?? null;
}
