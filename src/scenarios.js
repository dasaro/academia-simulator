// Scenario selection. Picks the next scenario based on:
//   - phase compatibility with current turn (year-1 → turns 1-12, etc.)
//   - `requires` condition satisfied
//   - not already in `state.seenScenarios` (unless `repeatable: true`)
//   - weighted random draw across the eligible set

import { evalCondition } from "./conditions.js";

const PHASE_RANGES = {
  "year-1": [1, 12],
  "year-2": [13, 24],
  "year-3": [25, 36],
  "year-4plus": [37, Infinity],
  any: [0, Infinity],
};

function phaseEligible(scenario, turn) {
  const phase = scenario.phase ?? "any";
  const range = PHASE_RANGES[phase];
  if (!range) return true;
  return turn >= range[0] && turn <= range[1];
}

export function eligibleScenarios(scenarios, state) {
  return scenarios.filter((s) => {
    if (!phaseEligible(s, state.turn)) return false;
    if (!s.repeatable && state.seenScenarios.includes(s.id)) return false;
    if (!evalCondition(s.requires, state)) return false;
    return true;
  });
}

function weightedPick(items, rng = Math.random) {
  const total = items.reduce((sum, it) => sum + (it.weight ?? 1), 0);
  if (total <= 0) return items[0] ?? null;
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight ?? 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function pickScenario(scenarios, state, rng = Math.random) {
  const pool = eligibleScenarios(scenarios, state);
  if (pool.length === 0) return null;
  // Welcome scenarios (intro: true) take strict priority on turn 1, so the
  // player gets a character-aware opener instead of a weighted-random scenario.
  if (state.turn === 1) {
    const intros = pool.filter((s) => s.intro === true);
    if (intros.length > 0) return weightedPick(intros, rng);
  }
  return weightedPick(pool, rng);
}
