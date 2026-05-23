// Random-event roller. Called once per turn after the scenario choice resolves.
// Each event has a `triggerChance` (0..1). If multiple events succeed in a
// single roll, the first one (deterministic order) fires. Each event fires
// at most once unless `repeatable: true`.

import { evalCondition } from "./conditions.js";

export function eligibleEvents(events, state) {
  return events.filter((e) => {
    if (!e.repeatable && state.firedEvents.includes(e.id)) return false;
    if (!evalCondition(e.requires, state)) return false;
    return true;
  });
}

export function rollEvent(events, state, rng = Math.random) {
  const pool = eligibleEvents(events, state);
  for (const evt of pool) {
    if (rng() < (evt.triggerChance ?? 0)) {
      return evt;
    }
  }
  return null;
}
