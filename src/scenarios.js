// Scenario selection. Picks the next scenario based on:
//   - phase compatibility with current turn (year-1 → turns 1-12, etc.)
//   - `requires` condition satisfied
//   - not already in `state.seenScenarios` (unless `repeatable: true`)
//   - repeatable cooldown (a repeatable can't fire again within REPEAT_COOLDOWN turns)
//   - weighted random draw, with TAG-RECENCY PENALTY so the same theme
//     doesn't dominate consecutive turns
//
// These last two pieces are the structural answer to "scenarios feel
// thematically repetitive." Even when the pool has 100+ eligible items,
// without these the high-weight magnets (SIRI down, supervisor blocks
// rendiconto) keep firing and tags cluster.

import { evalCondition } from "./conditions.js";

const PHASE_RANGES = {
  "year-1": [1, 12],
  "year-2": [13, 24],
  "year-3": [25, 36],
  "year-4plus": [37, Infinity],
  any: [0, Infinity],
};

// How many recent history entries to consider for tag-recency penalty
// and repeatable cooldown. 5 and 6 picked so the player doesn't see
// the same scene back-to-back but doesn't lock out the pool either.
const TAG_RECENCY_WINDOW = 5;
const REPEAT_COOLDOWN = 6;
// Multiplicative weight penalty per tag that appeared in the recent
// window. 0.4 means each repeated tag cuts the effective weight by 60%.
// Floor at 0.08 so a long-running theme isn't strictly eliminated —
// just heavily discouraged.
const TAG_PENALTY = 0.4;
const TAG_PENALTY_FLOOR = 0.08;

function phaseEligible(scenario, turn) {
  const phase = scenario.phase ?? "any";
  const range = PHASE_RANGES[phase];
  if (!range) return true;
  return turn >= range[0] && turn <= range[1];
}

// Returns the set of scenario IDs that fired within the last
// REPEAT_COOLDOWN turns. Repeatables in this set are skipped this turn.
function recentlyFiredIds(state) {
  const cutoff = state.turn - REPEAT_COOLDOWN;
  const out = new Set();
  for (const h of state.history) {
    if (h.scenarioId && h.turn > cutoff) out.add(h.scenarioId);
  }
  return out;
}

// Returns a frequency map of tags from the last TAG_RECENCY_WINDOW
// scenarios. {tag → count} — used to scale weights down for repeats.
function recentTagFrequency(scenarios, state) {
  const counts = new Map();
  const recent = state.history.slice(-TAG_RECENCY_WINDOW);
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  for (const h of recent) {
    if (!h.scenarioId) continue;
    const s = byId.get(h.scenarioId);
    if (!s) continue;
    for (const t of s.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

export function eligibleScenarios(scenarios, state) {
  const recentIds = recentlyFiredIds(state);
  return scenarios.filter((s) => {
    if (!phaseEligible(s, state.turn)) return false;
    if (!s.repeatable && state.seenScenarios.includes(s.id)) return false;
    // Repeatable cooldown: even if a scenario is repeatable, don't fire
    // it twice within REPEAT_COOLDOWN turns.
    if (s.repeatable && recentIds.has(s.id)) return false;
    if (!evalCondition(s.requires, state)) return false;
    return true;
  });
}

// Effective weight for a scenario given recent history. Multiplies the
// authored weight by TAG_PENALTY^k where k is how many of the scenario's
// tags appeared in the recent window. Floors at TAG_PENALTY_FLOOR so the
// theme never goes to zero — the rare high-relevance scene can still fire.
function effectiveWeight(scenario, tagFreq) {
  const baseWeight = scenario.weight ?? 1;
  if (!scenario.tags || scenario.tags.length === 0) return baseWeight;
  let penaltyExp = 0;
  for (const t of scenario.tags) {
    const f = tagFreq.get(t) ?? 0;
    if (f > 0) penaltyExp += f;
  }
  if (penaltyExp === 0) return baseWeight;
  const multiplier = Math.max(TAG_PENALTY_FLOOR, Math.pow(TAG_PENALTY, penaltyExp));
  return baseWeight * multiplier;
}

function weightedPick(items, weightFn, rng = Math.random) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[0] ?? null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickScenario(scenarios, state, rng = Math.random) {
  const pool = eligibleScenarios(scenarios, state);
  if (pool.length === 0) return null;
  // Welcome scenarios (intro: true) take strict priority on turn 1.
  if (state.turn === 1) {
    const intros = pool.filter((s) => s.intro === true);
    if (intros.length > 0) {
      return weightedPick(intros, (s) => s.weight ?? 1, rng);
    }
  }
  const tagFreq = recentTagFrequency(scenarios, state);
  return weightedPick(pool, (s) => effectiveWeight(s, tagFreq), rng);
}
