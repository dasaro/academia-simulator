// Evaluate JSON-encoded conditions against game state.
// Used by scenario `requires`, random-event `requires`, and ending `condition`.
//
// Supported shapes (any can be nested under `all` / `any`):
//   { minTurn: 30 }
//   { maxTurn: 60 }
//   { stats: { stamina: { lte: 0 } } }                // lte, gte, lt, gt, eq
//   { reputation: { barone: { lte: -5 } } }
//   { flags: { has: ["x", "y"] } }                     // ALL of
//   { flags: { hasAny: ["x", "y"] } }                  // any of
//   { flags: { hasNot: ["x", "y"] } }                  // none of
//   { inventory: { has: ["pubblicazione_extra"] } }
//   { all: [cond, cond, ...] }
//   { any: [cond, cond, ...] }
//
// Empty / undefined condition → true.

const NUMERIC_OPS = {
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  gt: (a, b) => a > b,
  eq: (a, b) => a === b,
};

function checkNumericMap(stateMap, condMap) {
  for (const [key, spec] of Object.entries(condMap)) {
    const value = stateMap[key] ?? 0;
    if (typeof spec === "number") {
      if (value !== spec) return false;
      continue;
    }
    for (const [op, target] of Object.entries(spec)) {
      const fn = NUMERIC_OPS[op];
      if (!fn) throw new Error(`Unknown numeric op: ${op}`);
      if (!fn(value, target)) return false;
    }
  }
  return true;
}

function checkListMembership(list, spec) {
  if (!spec) return true;
  // Shorthand: a bare array means "has all of these".
  if (Array.isArray(spec)) spec = { has: spec };
  const set = new Set(list);
  if (spec.has && !spec.has.every((x) => set.has(x))) return false;
  if (spec.hasAny && !spec.hasAny.some((x) => set.has(x))) return false;
  if (spec.hasNot && spec.hasNot.some((x) => set.has(x))) return false;
  return true;
}

export function evalCondition(cond, state) {
  if (!cond) return true;

  if (cond.all) return cond.all.every((c) => evalCondition(c, state));
  if (cond.any) return cond.any.some((c) => evalCondition(c, state));

  if (cond.minTurn !== undefined && state.turn < cond.minTurn) return false;
  if (cond.maxTurn !== undefined && state.turn > cond.maxTurn) return false;

  if (cond.stats && !checkNumericMap(state.stats, cond.stats)) return false;
  if (cond.reputation && !checkNumericMap(state.reputation, cond.reputation)) return false;

  if (cond.flags && !checkListMembership(state.flags, cond.flags)) return false;
  if (cond.inventory && !checkListMembership(state.inventory, cond.inventory)) return false;

  return true;
}
