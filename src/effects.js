// Apply JSON-encoded effects to game state (mutating).
// Effect shape:
//   {
//     stats:      { stamina: -3, burocrazia: +2 },
//     reputation: { supervisor: +1, barone: -2 },
//     inventory:  { add: ["pubblicazione_extra"], remove: ["debito_di_favori"] },
//     flags:      ["progetto_fantasma"]                 // shorthand: array = add
//     flagsAdd:   ["x"],                                 // explicit add
//     flagsRemove:["y"]                                  // explicit remove
//   }
//
// Stat & reputation values are clamped to their declared range (default 0..10
// for stats, -10..10 for reputation).

const STAT_MIN = 0;
const STAT_MAX = 10;
const REP_MIN = -10;
const REP_MAX = 10;

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function addUnique(arr, items) {
  if (!items) return;
  for (const item of items) {
    if (!arr.includes(item)) arr.push(item);
  }
}

function removeAll(arr, items) {
  if (!items) return;
  for (const item of items) {
    const idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
  }
}

export function applyEffects(state, effects) {
  if (!effects) return [];
  const log = [];

  if (effects.stats) {
    for (const [stat, delta] of Object.entries(effects.stats)) {
      const before = state.stats[stat] ?? 0;
      const after = clamp(before + delta, STAT_MIN, STAT_MAX);
      state.stats[stat] = after;
      if (after !== before) log.push({ kind: "stat", key: stat, delta: after - before });
    }
  }

  if (effects.reputation) {
    for (const [faction, delta] of Object.entries(effects.reputation)) {
      const before = state.reputation[faction] ?? 0;
      const after = clamp(before + delta, REP_MIN, REP_MAX);
      state.reputation[faction] = after;
      if (after !== before) log.push({ kind: "reputation", key: faction, delta: after - before });
    }
  }

  if (effects.inventory) {
    addUnique(state.inventory, effects.inventory.add);
    removeAll(state.inventory, effects.inventory.remove);
    if (effects.inventory.add) {
      for (const i of effects.inventory.add) log.push({ kind: "inventory", key: i, delta: 1 });
    }
    if (effects.inventory.remove) {
      for (const i of effects.inventory.remove) log.push({ kind: "inventory", key: i, delta: -1 });
    }
  }

  // `flags`: shorthand for add; `flagsAdd`/`flagsRemove`: explicit. We track
  // whether each was previously present so the delta log can show only real
  // state changes (no "set what was already set", no "remove what wasn't there").
  const beforeFlags = new Set(state.flags);
  if (Array.isArray(effects.flags)) addUnique(state.flags, effects.flags);
  addUnique(state.flags, effects.flagsAdd);
  removeAll(state.flags, effects.flagsRemove);

  const addCandidates = []
    .concat(Array.isArray(effects.flags) ? effects.flags : [])
    .concat(effects.flagsAdd ?? []);
  for (const f of addCandidates) {
    if (!beforeFlags.has(f)) log.push({ kind: "flag", key: f, delta: 1 });
  }
  for (const f of effects.flagsRemove ?? []) {
    if (beforeFlags.has(f)) log.push({ kind: "flag", key: f, delta: -1 });
  }

  return log;
}
