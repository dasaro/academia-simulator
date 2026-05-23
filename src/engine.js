// Game engine: state, turn loop, save/load.
// The engine is UI-agnostic — UI layer calls these functions and re-renders.

import { applyEffects } from "./effects.js";
import { pickScenario } from "./scenarios.js";
import { rollEvent } from "./randomEvents.js";
import { findEnding } from "./endings.js";
import { rollCheck, resolveBranch } from "./checks.js";
import { evalCondition } from "./conditions.js";
import { explainEnding, summarizeReasons } from "./explain.js";
import { interpolate } from "./interpolate.js";

export function createGameState(character, gender = "m", state = {}) {
  // Auto-add flags for the player's chosen "researcher state": gender,
  // contract type, age band, stance. These let scenarios gate via
  // `requires.flags` without any condition-DSL changes — they're just
  // starting flags. The stance can drift mid-game by setting/removing
  // stance_compliant/resistant/withdrawn from scenario effects.
  const genderFlag = `${gender}_gender`;
  const contractType = state.contractType || character.defaultContractType || "PON";
  const ageBand = state.ageBand || character.defaultAgeBand || "33to40";
  const stance = state.stance || character.defaultStance || "compliant";
  const contractFlag = `contract_${contractType}`;
  const ageFlag = `age_${ageBand}`;
  const stanceFlag = `stance_${stance}`;
  // Derived contract-class flags so scenarios can gate on "any RTD-A subtype"
  // instead of having to enumerate PON+PNRR+MSCA+FFO each time. The two
  // exclusive non-RTD-A classes get their own derived flag too.
  const RTDA_TYPES = new Set(["PON", "PNRR", "MSCA", "FFO"]);
  const derivedFlags = [];
  if (RTDA_TYPES.has(contractType)) derivedFlags.push("is_rtda");
  if (contractType === "POSTDOC")  derivedFlags.push("is_borsa");
  if (contractType === "CONTRATTISTA") derivedFlags.push("is_td_nonrtda");
  const startingFlags = [
    ...(character.startingFlags ?? []),
    genderFlag, contractFlag, ageFlag, stanceFlag,
    ...derivedFlags,
  ];
  return {
    character: { ...structuredClone(character), gender, contractType, ageBand, stance },
    turn: 1,
    stats: { ...character.stats },
    reputation: { ...character.startingReputation },
    inventory: [...(character.startingInventory ?? [])],
    flags: startingFlags,
    seenScenarios: [],
    firedEvents: [],
    history: [],
    feed: [],
    milestones: [],          // long-term narrative beats for the right column
    currentScenario: null,
    pendingEvent: null,
    perished: false,
    ending: null,
  };
}

// Subset of flags that mark a long-term narrative beat. Whenever one of these
// gets added to state.flags, we push a milestone entry that the right column
// can render as a "dossier" item. Keyed by flag slug → { title, category }.
const MILESTONE_FLAGS = {
  // pivotal one-time choices that define the arc
  candidato_pi_prin:       { title: "Ti sei candidato/a come PI sul PRIN",        category: "carriera" },
  prin_associato:          { title: "PRIN: presentato come associato al senior",  category: "carriera" },
  sfida_barone:            { title: "Hai sfidato il Barone in un concorso",       category: "politica" },
  cordata_barone:          { title: "Sei nella cordata del Barone",               category: "politica" },
  fuggito_estero:          { title: "Sei fuggito/a all'estero",                   category: "uscita" },
  lavoro_in_maternita:     { title: "Hai lavorato in maternità",                  category: "personale" },
  dimissionato:            { title: "Hai firmato le dimissioni",                  category: "uscita" },
  pers_dimissionato:       { title: "Hai firmato le dimissioni",                  category: "uscita" },
  pers_uscito_industria:   { title: "Sei uscito/a in industria",                  category: "uscita" },
  pers_burnout_clinico:    { title: "Diagnosi: burnout clinico",                  category: "salute" },
  pers_in_terapia:         { title: "Hai iniziato la psicoterapia",               category: "salute" },
  pers_terapia_interrotta: { title: "Hai interrotto la terapia",                  category: "salute" },
  pers_mutuo_negato:       { title: "La banca ti ha negato il mutuo",             category: "personale" },
  pers_partner_lontano:    { title: "Il/La partner si è trasferito/a lontano",    category: "personale" },
  pers_caregiver:          { title: "Sei caregiver di un familiare",              category: "personale" },
  pers_naspi:              { title: "Sei in NASpI",                               category: "uscita" },
  asn_bocciato:            { title: "ASN bocciata",                               category: "carriera" },
  career_bocciato_asn:     { title: "ASN bocciata",                               category: "carriera" },
  career_vinto_concorso_altrove: { title: "Hai vinto un concorso fuori",          category: "carriera" },
  career_silent_exit:      { title: "Hai scelto l'uscita silenziosa",             category: "uscita" },
  career_strutturato_ottenuto: { title: "Sei diventato/a strutturato/a (RTT)",     category: "carriera" },
  burocr_diffida_tar:      { title: "Hai diffidato l'ateneo / TAR",               category: "politica" },
  burocr_sindacato_attivato: { title: "Hai attivato il sindacato",                category: "politica" },
  burocr_lettera_collettiva: { title: "Hai firmato la lettera collettiva",        category: "politica" },
  fund_causa_ateneo:       { title: "Hai fatto causa all'ateneo",                 category: "politica" },
  attivista_visibile:      { title: "Sei riconoscibile come attivista",           category: "politica" },
  riforma_in_arrivo:       { title: "È in arrivo una riforma del reclutamento",   category: "contesto" },
};

function buildEndingEntry(ending, state) {
  const reasons = explainEnding(ending, state);
  return {
    kind: "ending",
    turn: state.turn,
    title: interpolate(ending.title, state),
    text: interpolate(ending.epilogue, state),
    cause: interpolate(ending.perishCause, state),
    resources: ending.resources ?? null,
    reasons,
    summary: summarizeReasons(reasons, ending),
    finalSnapshot: {
      stats: { ...state.stats },
      reputation: { ...state.reputation },
      scenariosSeen: state.seenScenarios.length,
      eventsFired: state.firedEvents.length,
      milestones: state.milestones.length,
      turn: state.turn,
    },
  };
}

function recordMilestones(state, deltaLog) {
  for (const entry of deltaLog) {
    if (entry.kind === "flag" && entry.delta > 0) {
      const m = MILESTONE_FLAGS[entry.key];
      if (m) {
        state.milestones.push({ turn: state.turn, flag: entry.key, title: m.title, category: m.category });
      }
    }
  }
}

// Data is `{ scenarios, events, endings, factions, characters }`.
// All loaded once at boot.

export function startGame(state, data) {
  advanceToNextScenario(state, data);
  return state;
}

// Cheap template interpolation:
//   {ssd}    → character.ssd
//   {name}   → character.name
//   {m|f}    → first | second based on character.gender
//   {m|f|x}  → first|second|third for m|f|nb (third optional, falls back to m)
//
// The {m|f} regex deliberately rejects strings containing braces so it doesn't
// match accidentally inside other markup.
// Returns true if the player meets the requirements to take this choice.
// Used both for UI gating (disabled vs enabled buttons) and as a final
// sanity check inside applyChoice.
export function choiceAvailable(choice, state) {
  if (choice.requires && !evalCondition(choice.requires, state)) return false;
  if (choice.consume) {
    for (const item of choice.consume) {
      if (!state.inventory.includes(item)) return false;
    }
  }
  return true;
}

function consumeItems(state, items) {
  if (!items) return;
  for (const item of items) {
    const idx = state.inventory.indexOf(item);
    if (idx !== -1) state.inventory.splice(idx, 1);
  }
}

// Shared resolver for a choice (scenario, event, or item branch). Handles:
//   - consume items + log feed entry
//   - resolve D&D check + log roll
//   - apply effects + log delta + record milestones
//   - return the reaction (caller decides when/how to push it)
//
// The `source` controls the delta entry label and (for events) used by the UI
// for visual grouping.
function resolveChoice(state, choice, source = "choice") {
  consumeItems(state, choice.consume);
  if (choice.consume?.length) {
    state.feed.push({ kind: "consume", turn: state.turn, items: choice.consume });
  }

  let effectsToApply = choice.effects;
  let reactionToShow = choice.reaction;

  if (choice.check) {
    const rollResult = rollCheck(choice.check, state);
    const { kind: outcome, ...rollDetail } = rollResult;
    state.feed.push({ kind: "roll", turn: state.turn, source, outcome, ...rollDetail });
    const branch = resolveBranch(choice.check, rollResult.kind);
    if (branch) {
      effectsToApply = branch.effects ?? effectsToApply;
      reactionToShow = branch.reaction ?? reactionToShow;
    }
  }

  const deltaLog = applyEffects(state, effectsToApply);
  recordMilestones(state, deltaLog);
  if (deltaLog.length > 0) {
    state.feed.push({ kind: "delta", turn: state.turn, source, changes: deltaLog });
  }

  return reactionToShow;
}

// Common "after the player's input is fully resolved" tail: ending check,
// turn advance, next scenario. Used by both applyChoice and applyEventChoice.
function finalizeTurn(state, data) {
  const ending = findEnding(data.endings, state);
  if (ending) {
    state.perished = true;
    state.ending = ending;
    state.feed.push(buildEndingEntry(ending, state));
    return state;
  }
  state.turn += 1;
  applyPassiveRegen(state);
  advanceToNextScenario(state, data);
  return state;
}

export function applyChoice(state, data, choice) {
  if (state.perished || !state.currentScenario) return state;
  // Block scenario choices only when there's an unresolved INTERACTIVE event;
  // a passive event lingers as a pendant reference and shouldn't gate input.
  if (state.pendingEvent?.choices?.length) return state;
  if (!choiceAvailable(choice, state)) return state;  // ignore invalid clicks

  const scenarioId = state.currentScenario.id;
  const reactionToShow = resolveChoice(state, choice, "choice");

  state.history.push({ turn: state.turn, scenarioId, label: choice.label });
  state.feed.push({
    kind: "choice",
    turn: state.turn,
    scenarioTitle: state.currentScenario.title,
    label: interpolate(choice.label, state),
  });
  if (reactionToShow) {
    state.feed.push({
      kind: "reaction",
      turn: state.turn,
      from: reactionToShow.from ?? null,
      text: interpolate(reactionToShow.text, state),
    });
  }

  if (!state.seenScenarios.includes(scenarioId)) {
    state.seenScenarios.push(scenarioId);
  }

  // Roll a random event. If it has choices, PAUSE here: the UI will render
  // the event's choices and the player resolves it via applyEventChoice.
  const event = rollEvent(data.events, state);
  if (event) {
    state.firedEvents.push(event.id);
    state.feed.push({ kind: "event", turn: state.turn, title: interpolate(event.title, state), text: interpolate(event.text, state) });

    if (event.choices?.length) {
      // Interactive event — auto-effects (if any) still apply as a baseline,
      // then we pause for player input. The event's own `effects` field is
      // optional and treated as "before-choice background changes".
      if (event.effects) {
        const eventLog = applyEffects(state, event.effects);
        recordMilestones(state, eventLog);
        if (eventLog.length > 0) {
          state.feed.push({ kind: "delta", turn: state.turn, source: "event", changes: eventLog });
        }
      }
      state.pendingEvent = event;
      // Important: do NOT advance turn or check endings yet — wait for choice.
      return state;
    }

    // Passive event — auto-apply effects, continue.
    const eventLog = applyEffects(state, event.effects);
    recordMilestones(state, eventLog);
    state.pendingEvent = event;
    if (eventLog.length > 0) {
      state.feed.push({ kind: "delta", turn: state.turn, source: "event", changes: eventLog });
    }
  } else {
    state.pendingEvent = null;
  }

  return finalizeTurn(state, data);
}

// Called when the player picks a choice on an event that surfaced with
// `choices`. Resolves the choice (check, consume, effects, reaction), clears
// the pendingEvent, and then runs the normal end-of-turn flow.
export function applyEventChoice(state, data, choice) {
  if (state.perished || !state.pendingEvent || !state.pendingEvent.choices) return state;
  if (!choiceAvailable(choice, state)) return state;

  const event = state.pendingEvent;
  const reactionToShow = resolveChoice(state, choice, "event_choice");

  state.history.push({ turn: state.turn, eventId: event.id, label: choice.label });
  state.feed.push({
    kind: "event_choice",
    turn: state.turn,
    eventTitle: interpolate(event.title, state),
    label: interpolate(choice.label, state),
  });
  if (reactionToShow) {
    state.feed.push({
      kind: "reaction",
      turn: state.turn,
      from: reactionToShow.from ?? null,
      text: interpolate(reactionToShow.text, state),
    });
  }

  state.pendingEvent = null;
  return finalizeTurn(state, data);
}

// Slow stamina recovery — humans heal, even in academia. Without this the
// monotonic stamina drain from cumulative scenario choices would cause
// burnout endings to dominate every playthrough.
function applyPassiveRegen(state) {
  if (state.flags.includes("burnout_prone")) {
    // Burnout-prone characters get half the recovery: +1 every other turn.
    if (state.turn % 2 === 0 && state.stats.stamina < 10) state.stats.stamina += 1;
  } else if (state.stats.stamina < 10) {
    state.stats.stamina += 1;
  }
}

const MAX_TURNS = 72;  // hard cap: 6 academic years

function advanceToNextScenario(state, data) {
  // Skip empty months (no eligible scenario) up to MAX_TURNS. Without this,
  // the early-game pool exhaustion would falsely fire the scadenza ending.
  while (state.turn <= MAX_TURNS) {
    const next = pickScenario(data.scenarios, state);
    if (next) {
      state.currentScenario = next;
      state.feed.push({
        kind: "scenario",
        turn: state.turn,
        title: interpolate(next.title, state),
        text: interpolate(next.text, state),
      });
      return;
    }
    state.turn += 1;
    // After advancing, re-check perish conditions — endings like
    // scadenza_silenziosa (minTurn: 60) may now match.
    const ending = findEnding(data.endings, state);
    if (ending) {
      state.perished = true;
      state.ending = ending;
      state.feed.push(buildEndingEntry(ending, state));
      state.currentScenario = null;
      return;
    }
  }
  // Hard timeout — should never hit in practice
  state.currentScenario = null;
}

// Free-use items ("magic items"): consumed from the inventory panel at any
// time, outside the scenario choice flow. Some have a d20 roll for variable
// outcomes; others are deterministic. Item definitions live in
// data/game/items.json — `usable: true` marks the freely-usable ones.
export function useItem(state, data, itemId) {
  if (state.perished) return state;
  if (!state.inventory.includes(itemId)) return state;
  const item = data.items?.find((i) => i.id === itemId);
  if (!item?.usable || !item.use) return state;

  // Consume first so the player can't accidentally double-use via a race.
  const idx = state.inventory.indexOf(itemId);
  if (idx !== -1) state.inventory.splice(idx, 1);
  state.feed.push({
    kind: "item_used",
    turn: state.turn,
    itemId,
    itemName: interpolate(item.name, state),
  });

  // Resolve: optional roll, then effects + reaction.
  let effectsToApply = item.use.effects;
  let reactionToShow = item.use.reaction;
  if (item.use.roll) {
    const rollResult = rollCheck(item.use.roll, state);
    const { kind: outcome, ...rollDetail } = rollResult;
    state.feed.push({
      kind: "roll",
      turn: state.turn,
      source: "item",
      outcome,
      ...rollDetail,
    });
    const branch = resolveBranch(item.use.roll, outcome);
    if (branch) {
      effectsToApply = branch.effects ?? effectsToApply;
      reactionToShow = branch.reaction ?? reactionToShow;
    }
  }
  if (effectsToApply) {
    const deltaLog = applyEffects(state, effectsToApply);
    recordMilestones(state, deltaLog);
    if (deltaLog.length > 0) {
      state.feed.push({ kind: "delta", turn: state.turn, source: "item", changes: deltaLog });
    }
  }
  if (reactionToShow) {
    state.feed.push({
      kind: "reaction",
      turn: state.turn,
      from: reactionToShow.from ?? null,
      text: interpolate(reactionToShow.text, state),
    });
  }

  // Items can also fire endings (e.g. burnout pill that pushes you over).
  const ending = findEnding(data.endings, state);
  if (ending) {
    state.perished = true;
    state.ending = ending;
    state.feed.push(buildEndingEntry(ending, state));
  }

  return state;
}

// Persistence is delegated to a storage adapter (see src/storage.js). The
// engine itself never touches `sessionStorage` directly, so it remains usable
// in Node test harnesses, React Native shells, or any environment that
// supplies a `{ load, save, clear }` triple.
const SAVE_KEY = "academiasim.save.v1";

let storageAdapter = null;

export function setStorageAdapter(adapter) {
  storageAdapter = adapter;
}

export function saveState(state) {
  if (!storageAdapter) return;
  storageAdapter.save(SAVE_KEY, state);
}

export function loadState() {
  if (!storageAdapter) return null;
  return storageAdapter.load(SAVE_KEY);
}

export function clearSave() {
  if (!storageAdapter) return;
  storageAdapter.clear(SAVE_KEY);
}
