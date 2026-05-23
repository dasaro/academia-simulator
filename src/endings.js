// Perish-ending detector. Checked after every state change.
// Endings are sorted by descending `priority`; the first whose `condition`
// matches the current state fires. The game ends in a "perish" — there are
// no victory endings by design.

import { evalCondition } from "./conditions.js";

export function findEnding(endings, state) {
  const sorted = [...endings].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const e of sorted) {
    if (evalCondition(e.condition, state)) return e;
  }
  return null;
}
