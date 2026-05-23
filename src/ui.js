// Vanilla DOM rendering. No framework, no virtual DOM. Re-renders the whole
// screen on each state change — the game is small enough that this is fine.

import { evalCondition } from "./conditions.js";
import { interpolate } from "./interpolate.js";

// Drawer state — driven by a single `body[data-drawer]` attribute that the
// CSS responds to via `body[data-drawer="sidebar"] .sidebar { transform: 0 }`.
// This keeps the UI logic minimal and lets the layout be entirely CSS-driven.
function toggleDrawer(name) {
  if (document.body.getAttribute("data-drawer") === name) {
    document.body.removeAttribute("data-drawer");
  } else {
    document.body.setAttribute("data-drawer", name);
  }
}

// Track how many feed entries the user has already seen, so that on each
// render we can mark only the genuinely-new entries with an `entering`
// class and animate them in (staggered) without re-animating the whole feed.
// Reset to 0 when the feed shrinks (new game) or character changes.
let _lastFeedLength = 0;
let _lastCharacterId = null;

const STAT_LABELS = {
  intelligenza: "Intelligenza",
  networking: "Networking",
  stamina: "Stamina",
  burocrazia: "Burocrazia",
  fondi: "Fondi",
  persuasione: "Persuasione",
};

const CONTRACT_LABELS = {
  POSTDOC:      "Assegnista / Borsa",
  PON:          "RTD-A PON",
  PNRR:         "RTD-A PNRR",
  MSCA:         "MSCA / Seal",
  FFO:          "FFO d'ateneo",
  CONTRATTISTA: "Contrattista",
};
const AGE_LABELS = {
  under33: "28–32",
  "33to40": "33–40",
  over40:  "41+",
};
const STANCE_LABELS = {
  compliant: "allineat{o|a}",
  resistant: "militante",
  withdrawn: "disimpegnat{o|a}",
};
function contractLabel(id) { return CONTRACT_LABELS[id] || id || "RTD-A"; }
function ageLabel(id) { return AGE_LABELS[id] || id || ""; }
function stanceLabel(id, gender) {
  const raw = STANCE_LABELS[id] || id || "";
  return interpolate(raw, { character: { gender } });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "onClick") node.addEventListener("click", v);
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function renderContentWarning(root, onDismiss) {
  root.innerHTML = "";
  const wrap = el("div", { className: "screen screen--cw" });
  const card = el("div", { className: "cw-card" });
  card.appendChild(el("h1", {}, "Prima di iniziare"));
  card.appendChild(el("p", { className: "cw-body" },
    "Academia Simulator è una satira della carriera accademica italiana, costruita su casi pubblicamente documentati e su osservazione personale dell'ambiente. La storia tocca temi che possono essere difficili: precariato cronico, burnout, crisi psichiatriche, esiti tragici, molestie e abusi di potere su base sessuale."));
  card.appendChild(el("p", { className: "cw-body" },
    "Le scene di molestia e di coercizione sono presentate in modo clinico, mai grafico; servono a nominare un problema reale dell'accademia italiana di cui spesso non si parla. I finali più gravi mostrano sempre risorse di aiuto reali (1522, Differenza Donna, Telefono Amico, Samaritans, CUG d'ateneo). Non c'è un finale di vittoria — il gioco è una critica del sistema, non un percorso di successo."));
  card.appendChild(el("p", { className: "cw-body cw-note" },
    "Se stai attraversando un momento difficile o hai subito violenza, considera di fermarti qui. Numero antiviolenza nazionale: 1522 (24h, gratuito, anonimo). Telefono Amico Italia: 02 2327 2327. Samaritans Onlus: 06 77208977."));
  const btn = el("button", { className: "btn cw-btn", onClick: onDismiss }, "Ho letto. Continua.");
  card.appendChild(btn);
  wrap.appendChild(card);
  root.appendChild(wrap);
}

export function renderCharacterSelect(root, characters, onSelect) {
  root.innerHTML = "";
  _charactersForBack = characters;
  const wrap = el("div", { className: "screen screen--select" });

  wrap.appendChild(el("h1", {}, "Academia Simulator"));
  wrap.appendChild(el("p", { className: "tagline" },
    "Una carriera accademica italiana. Tre anni, prorogabili. Forse."));
  wrap.appendChild(el("p", { className: "tagline" },
    "Scegli archetipo, genere, tipo di contratto e fascia d'età. Ogni combinazione apre scenari diversi."));

  const grid = el("div", { className: "char-grid" });
  for (const c of characters) {
    const card = el("div", { className: "char-card" });
    card.appendChild(el("h2", {}, c.name));
    card.appendChild(el("div", { className: "ssd" }, `SSD ${c.ssd}`));
    card.appendChild(el("p", { className: "tagline" }, c.tagline));
    card.appendChild(renderStatBars(c.stats));
    const genderRow = el("div", { className: "gender-row" });
    genderRow.appendChild(el("button", {
      className: "btn btn--gender",
      onClick: () => renderStatePicker(root, c, "f", onSelect),
    }, "Gioca come donna"));
    genderRow.appendChild(el("button", {
      className: "btn btn--gender",
      onClick: () => renderStatePicker(root, c, "m", onSelect),
    }, "Gioca come uomo"));
    card.appendChild(genderRow);
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  root.appendChild(wrap);
}

// Step 2: pick contract type + age band + stance. Each choice sets starting
// flags that the scenario pool gates on. Together they shape who you are:
// "what you got hired as", "how old you are", "how you relate to power."
const CONTRACT_TYPES = [
  { id: "POSTDOC", name: "Assegnista / Borsa post-doc", hint: "Borsa di ricerca o assegno. Lordo uguale netto. Niente INPS, niente NASPI, niente maternità piena. Esiste sulla carta intestata di qualcun{o|a} altr{o|a}." },
  { id: "PON",     name: "RTD-A PON / DM 1062",         hint: "Il classico precariato R&I. Tre anni più due, forse. Vincolo al progetto. La rendicontazione su SIRI ti consuma." },
  { id: "PNRR",    name: "RTD-A PNRR",                  hint: "Contratto più recente, clausole peggiori. Restituzione mensilità se ti dimetti. Milestone scritte in tre giorni e vincolanti." },
  { id: "MSCA",    name: "Marie Curie / Seal of Excellence", hint: "Sei rientrat{o|a} dall'estero. Chiamata diretta teorica. L'ateneo riscrive il pre-accordo all'ultimo." },
  { id: "FFO",     name: "FFO d'ateneo",                hint: "Più rar{o|a}: fondi d'ateneo. Meno vincoli ministeriali, più dipendenza dal direttore di dipartimento." },
  { id: "CONTRATTISTA", name: "Contrattista / Docente a contratto", hint: "TD non-RTD: didattica a contratto, spin-off, fondazione. Rinnovo a sei mesi. Carta intestata che cambia. Tornare a scuola è il paracadute." },
];

const AGE_BANDS = [
  { id: "under33", name: "28–32 anni", hint: "La finestra under-40 è ancora lunga. Famiglia rimandata. Ancora pensi che il sistema sia riformabile." },
  { id: "33to40",  name: "33–40 anni", hint: "La finestra si stringe. Family-formation pressure. Il tuo ASN deve passare entro 2-3 anni." },
  { id: "over40",  name: "41+ anni",   hint: "Sei oltre il treno degli under-40. Telematica come opzione realistica. Ogni concorso pesa il doppio." },
];

// Stance / schieramento — how you relate to power. Each is a way of
// surviving; each costs something different. Chat-grounded in the three
// recurring voices: who plays the game, who fights, who disappears.
const STANCES = [
  { id: "compliant", name: "Allineat{o|a}",   hint: "Giochi le carte. Resti nella cordata del supervisor. Sicurezza in cambio dell'anima: a tre anni, se va bene, sarai parte del sistema. Te ne accorgi tardi." },
  { id: "resistant", name: "Militante",        hint: "Firmi le lettere, chiami il sindacato, vai in consiglio. Hai ragione e paghi: ritorsioni, esclusioni, esaurimento. A volte, una vittoria." },
  { id: "withdrawn", name: "Disimpegnat{o|a}", hint: "Fai la tua ricerca. Non vai ai consigli, non firmi niente. Diventi invisibile. Primo della lista quando tagliano." },
];

function renderStatePicker(root, character, gender, onSelect) {
  root.innerHTML = "";
  const wrap = el("div", { className: "screen screen--select" });
  wrap.appendChild(el("h1", {}, character.name));
  wrap.appendChild(el("p", { className: "tagline" },
    `${gender === "f" ? "Donna" : "Uomo"} · SSD ${character.ssd} · ${character.tagline}`));

  const state = { contractType: character.defaultContractType || "PON",
                  ageBand: character.defaultAgeBand || "33to40",
                  stance: character.defaultStance || "compliant" };

  const contractCard = el("div", { className: "state-card" });
  contractCard.appendChild(el("h3", {}, "Tipo di contratto"));
  const contractGroup = el("div", { className: "state-options" });
  function renderContracts() {
    contractGroup.innerHTML = "";
    for (const c of CONTRACT_TYPES) {
      const opt = el("button", {
        className: `state-option${state.contractType === c.id ? " selected" : ""}`,
        onClick: () => { state.contractType = c.id; renderContracts(); },
      });
      opt.appendChild(el("strong", {}, c.name));
      opt.appendChild(el("span", { className: "state-hint" }, interpolate(c.hint, { character: { gender } })));
      contractGroup.appendChild(opt);
    }
  }
  renderContracts();
  contractCard.appendChild(contractGroup);

  const ageCard = el("div", { className: "state-card" });
  ageCard.appendChild(el("h3", {}, "Fascia d'età"));
  const ageGroup = el("div", { className: "state-options" });
  function renderAges() {
    ageGroup.innerHTML = "";
    for (const a of AGE_BANDS) {
      const opt = el("button", {
        className: `state-option${state.ageBand === a.id ? " selected" : ""}`,
        onClick: () => { state.ageBand = a.id; renderAges(); },
      });
      opt.appendChild(el("strong", {}, a.name));
      opt.appendChild(el("span", { className: "state-hint" }, a.hint));
      ageGroup.appendChild(opt);
    }
  }
  renderAges();
  ageCard.appendChild(ageGroup);

  const stanceCard = el("div", { className: "state-card" });
  stanceCard.appendChild(el("h3", {}, "Schieramento"));
  stanceCard.appendChild(el("p", { className: "state-card__sub" },
    "Non sceglierai sempre coerentemente — la vita ti spinge. Ma da qualche parte si parte."));
  const stanceGroup = el("div", { className: "state-options" });
  function renderStances() {
    stanceGroup.innerHTML = "";
    for (const s of STANCES) {
      const opt = el("button", {
        className: `state-option${state.stance === s.id ? " selected" : ""}`,
        onClick: () => { state.stance = s.id; renderStances(); },
      });
      opt.appendChild(el("strong", {}, interpolate(s.name, { character: { gender } })));
      opt.appendChild(el("span", { className: "state-hint" }, interpolate(s.hint, { character: { gender } })));
      stanceGroup.appendChild(opt);
    }
  }
  renderStances();
  stanceCard.appendChild(stanceGroup);

  wrap.appendChild(contractCard);
  wrap.appendChild(ageCard);
  wrap.appendChild(stanceCard);

  const actions = el("div", { className: "state-actions" });
  actions.appendChild(el("button", {
    className: "btn btn--ghost",
    onClick: () => { if (_charactersForBack) renderCharacterSelect(root, _charactersForBack, onSelect); },
  }, "← Indietro"));
  actions.appendChild(el("button", {
    className: "btn btn--gender",
    onClick: () => onSelect(character, gender, state),
  }, "Inizia"));
  wrap.appendChild(actions);

  root.appendChild(wrap);
}

// Cache the character list at character-select time so the state picker's
// "← Indietro" button can re-render the same list without main.js wiring.
let _charactersForBack = null;

function renderStatBars(stats) {
  const wrap = el("div", { className: "stat-bars" });
  for (const [key, label] of Object.entries(STAT_LABELS)) {
    const value = stats[key] ?? 0;
    const bar = el("div", { className: "stat-bar" },
      el("span", { className: "stat-bar__label" }, label),
      el("span", { className: "stat-bar__track" },
        el("span", { className: "stat-bar__fill", style: `width: ${value * 10}%` })),
      el("span", { className: "stat-bar__value" }, String(value)),
    );
    wrap.appendChild(bar);
  }
  return wrap;
}

function renderRepBars(reputation, factions) {
  const wrap = el("div", { className: "rep-bars" });
  for (const f of factions) {
    const value = reputation[f.id] ?? 0;
    const pct = ((value + 10) / 20) * 100;
    const cls = value < 0 ? "rep-bar__fill rep-bar__fill--neg" : "rep-bar__fill";
    const bar = el("div", { className: "rep-bar", title: f.description },
      el("span", { className: "rep-bar__label" }, f.name),
      el("span", { className: "rep-bar__track" },
        el("span", { className: cls, style: `width: ${pct}%` })),
      el("span", { className: "rep-bar__value" }, value > 0 ? `+${value}` : String(value)),
    );
    wrap.appendChild(bar);
  }
  return wrap;
}

export function renderGame(root, state, factions, items, handlers) {
  root.innerHTML = "";
  // Reset any open drawer on each render so the screen doesn't get stuck in a
  // drawer-open state across choices (which would obscure the new scenario).
  document.body.removeAttribute("data-drawer");

  const wrap = el("div", { className: "screen screen--game" });

  // Mobile-only top bar: hamburger (sidebar) + title + dossier-toggle.
  // Hidden via CSS on desktop (.mobile-bar default `display: none`).
  const mbar = el("div", { className: "mobile-bar" });
  mbar.appendChild(el("button", {
    className: "mobile-bar__btn",
    "aria-label": "Apri stats e inventario",
    onClick: () => toggleDrawer("sidebar"),
  }, "☰"));
  mbar.appendChild(el("div", { className: "mobile-bar__title" }, state.character.name));
  mbar.appendChild(el("div", { className: "mobile-bar__turn" },
    `M${state.turn} · A${Math.ceil(state.turn / 12)}`));
  mbar.appendChild(el("button", {
    className: "mobile-bar__btn",
    "aria-label": "Apri dossier",
    onClick: () => toggleDrawer("dossier"),
  }, "📔"));
  wrap.appendChild(mbar);

  // Scrim overlay — taps outside an open drawer close it.
  const scrim = el("div", {
    className: "drawer-scrim",
    onClick: () => document.body.removeAttribute("data-drawer"),
  });
  wrap.appendChild(scrim);

  // Left sidebar: live stats, reputation, inventory
  const sidebar = el("aside", { className: "sidebar" });
  sidebar.appendChild(el("div", { className: "char-summary" },
    el("h3", {}, state.character.name),
    el("div", { className: "ssd" }, state.character.ssd),
    el("div", { className: "char-state" }, contractLabel(state.character.contractType) + " · " + ageLabel(state.character.ageBand)),
    el("div", { className: "char-stance" }, stanceLabel(state.character.stance, state.character.gender)),
    el("div", { className: "turn-counter" }, `Mese ${state.turn}  ·  Anno ${Math.ceil(state.turn / 12)}`),
  ));
  sidebar.appendChild(el("h4", {}, "Stats"));
  sidebar.appendChild(renderStatBars(state.stats));
  sidebar.appendChild(el("h4", {}, "Reputazione"));
  sidebar.appendChild(renderRepBars(state.reputation, factions));

  if (state.inventory.length > 0) {
    sidebar.appendChild(el("h4", {}, "Inventario"));
    const list = el("ul", { className: "inventory" });
    for (const itemId of state.inventory) {
      const def = items?.find((i) => i.id === itemId);
      list.appendChild(renderInventoryItem(itemId, def, handlers));
    }
    sidebar.appendChild(list);
  }
  sidebar.appendChild(el("button", { className: "btn btn--ghost", onClick: handlers.onRestart },
    "Ricomincia"));

  // Detect feed continuity. If the player just started a new run (character
  // changed, or feed shrank), reset our "what's already been seen" pointer
  // so we don't pretend the very first feed entry is animating in.
  if (state.character?.id !== _lastCharacterId || state.feed.length < _lastFeedLength) {
    _lastFeedLength = 0;
  }
  _lastCharacterId = state.character?.id ?? null;

  // Main feed. Entries beyond `_lastFeedLength` are new since the last render
  // (e.g. just produced by applyChoice / applyEventChoice / useItem) — mark
  // them so the CSS staggers their fade-in animation.
  const main = el("main", { className: "feed" });
  for (let i = 0; i < state.feed.length; i++) {
    const node = renderFeedEntry(state.feed[i]);
    if (node && i >= _lastFeedLength) {
      node.classList.add("entering");
      // Stagger via CSS variable; the CSS multiplies by ~50ms.
      node.style.setProperty("--enter-idx", String(i - _lastFeedLength));
    }
    if (node) main.appendChild(node);
  }

  // Choices: a pending interactive event takes precedence over the current
  // scenario's choices (the event is "blocking" until resolved).
  if (!state.perished) {
    if (state.pendingEvent?.choices?.length) {
      const choices = el("div", { className: "choices choices--event" });
      for (const c of state.pendingEvent.choices) {
        choices.appendChild(renderChoice(c, state, { ...handlers, onChoice: handlers.onEventChoice }));
      }
      main.appendChild(choices);
    } else if (state.currentScenario) {
      const choices = el("div", { className: "choices" });
      for (const c of state.currentScenario.choices) {
        choices.appendChild(renderChoice(c, state, handlers));
      }
      main.appendChild(choices);
    }
  }

  if (state.perished) {
    main.appendChild(el("div", { className: "perish-banner" },
      el("h2", {}, "Perish."),
      el("div", { className: "perish-cause" }, interpolate(state.ending.perishCause, state)),
      el("button", { className: "btn", onClick: handlers.onRestart }, "Nuova carriera"),
    ));
  }

  // Right column: dossier — long-term narrative state (milestones + flag log)
  const dossier = renderDossier(state);

  wrap.appendChild(sidebar);
  wrap.appendChild(main);
  wrap.appendChild(dossier);
  root.appendChild(wrap);

  // Smooth-scroll the feed to the most recent new content. We give the entry
  // animations a moment to begin before the scroll kicks in so the user sees
  // the transition rather than just a jump-to-bottom. requestAnimationFrame
  // is used so the layout settles first.
  const firstNew = main.querySelector(".feed-entry.entering");
  requestAnimationFrame(() => {
    if (firstNew) {
      // If there's an interactive choice block, scroll the LAST new entry
      // into view rather than the first — keeps the player's eyes on the
      // freshest content. We scroll the feed container, not the page.
      main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
    } else {
      main.scrollTop = main.scrollHeight;
    }
  });

  // Mark these entries as "seen" — next render starts staggering from here.
  _lastFeedLength = state.feed.length;
}

const MILESTONE_CATEGORY_LABEL = {
  carriera: "Carriera",
  politica: "Politica & vertenze",
  uscita: "Vie d'uscita",
  personale: "Vita personale",
  salute: "Salute",
  contesto: "Contesto",
};

function renderDossier(state) {
  const dossier = el("aside", { className: "dossier" });
  dossier.appendChild(el("h3", {}, "Dossier"));
  dossier.appendChild(el("p", { className: "dossier-tagline" }, "Cosa pesa sulla tua carriera"));

  // Milestones grouped by category
  if (state.milestones.length > 0) {
    const byCategory = {};
    for (const m of state.milestones) {
      (byCategory[m.category] ??= []).push(m);
    }
    for (const cat of Object.keys(MILESTONE_CATEGORY_LABEL)) {
      const items = byCategory[cat];
      if (!items?.length) continue;
      dossier.appendChild(el("h4", {}, MILESTONE_CATEGORY_LABEL[cat]));
      const list = el("ul", { className: "milestones" });
      for (const m of items) {
        list.appendChild(el("li", {},
          el("span", { className: "milestone-month" }, `M${m.turn}`),
          el("span", { className: "milestone-title" }, interpolate(m.title, state)),
        ));
      }
      dossier.appendChild(list);
    }
  } else {
    dossier.appendChild(el("p", { className: "dossier-empty" },
      "Nessun evento di rilievo ancora. Ogni decisione importante apparirà qui."));
  }

  // Active tags (non-milestone flags, compact)
  const milestoneFlagSet = new Set(state.milestones.map((m) => m.flag));
  const otherFlags = state.flags.filter((f) => !milestoneFlagSet.has(f));
  if (otherFlags.length > 0) {
    dossier.appendChild(el("h4", {}, "Tag attivi"));
    const list = el("ul", { className: "flags" });
    for (const f of otherFlags) list.appendChild(el("li", {}, formatItemName(f)));
    dossier.appendChild(list);
  }

  // Counters: pubblicazioni, concorsi visti, etc. — derive from state
  const stats = computeNarrativeStats(state);
  dossier.appendChild(el("h4", {}, "Conteggi"));
  const cList = el("ul", { className: "counters" });
  for (const [label, value] of stats) {
    cList.appendChild(el("li", {},
      el("span", { className: "counter-label" }, label),
      el("span", { className: "counter-value" }, String(value)),
    ));
  }
  dossier.appendChild(cList);

  return dossier;
}

function computeNarrativeStats(state) {
  const out = [];
  const pubCount = state.inventory.filter((i) => i.startsWith("pubblicazione")).length;
  out.push(["Pubblicazioni", pubCount]);
  const classeA = state.inventory.filter((i) => i === "pubblicazione_classe_a").length;
  if (classeA > 0) out.push(["di cui classe A", classeA]);
  out.push(["Mese attuale", state.turn]);
  out.push(["Scenari visti", state.seenScenarios.length]);
  out.push(["Eventi", state.firedEvents.length]);
  return out;
}

const STAT_DISPLAY = {
  intelligenza: "Intelligenza", networking: "Networking", stamina: "Stamina",
  burocrazia: "Burocrazia", fondi: "Fondi", persuasione: "Persuasione",
};

const FACTION_DISPLAY = {
  supervisor: "Responsabile", peers: "Gli Altri Precari", barone: "Il Barone",
  mur: "MUR", ateneo_hr: "Ufficio Risorse Umane",
};

function formatItemList(items) {
  return items.map(formatItemName).join(", ");
}

function renderInventoryItem(itemId, def, handlers) {
  const name = def?.name ?? formatItemName(itemId);
  const description = def?.description ?? "Oggetto senza descrizione.";
  const isUsable = def?.usable && def?.use;
  const hasRoll = !!def?.use?.roll;
  // Tapping anywhere on the item row opens the description sheet. The "Usa"
  // button stays as a quick-tap shortcut, and stops propagation so its tap
  // doesn't also open the sheet.
  const li = el("li", {
    className: `inv-item${isUsable ? " inv-item--usable" : ""}`,
    onClick: () => openItemSheet(itemId, def, handlers),
  });
  // Desktop fallback: native tooltip still works for mouse users.
  li.setAttribute("title", description);
  li.appendChild(el("span", { className: "inv-item__label" }, name));
  if (isUsable) {
    const btn = el("button", {
      className: "inv-item__use",
      onClick: (e) => { e.stopPropagation(); handlers.onUseItem(itemId); },
    }, hasRoll ? "Usa 🎲" : "Usa");
    li.appendChild(btn);
  }
  return li;
}

// Tap-to-show item sheet: works on touch where hover doesn't. Renders as a
// bottom sheet on phones, centered card on desktop (the parent .item-sheet
// container uses flex `align-items: flex-end` + a max-width on the card).
function openItemSheet(itemId, def, handlers) {
  const existing = document.querySelector(".item-sheet");
  if (existing) existing.remove();
  const close = () => { sheet.remove(); };
  const sheet = el("div", { className: "item-sheet", onClick: (e) => { if (e.target === sheet) close(); } });
  const card = el("div", { className: "item-sheet__card" });
  card.appendChild(el("h3", { className: "item-sheet__name" }, def?.name ?? formatItemName(itemId)));
  card.appendChild(el("p", { className: "item-sheet__desc" }, def?.description ?? "Oggetto senza descrizione."));
  const actions = el("div", { className: "item-sheet__actions" });
  actions.appendChild(el("button", { className: "item-sheet__close", onClick: close }, "Chiudi"));
  if (def?.usable && def?.use) {
    const hasRoll = !!def.use.roll;
    actions.appendChild(el("button", {
      className: "item-sheet__use",
      onClick: () => { close(); handlers.onUseItem(itemId); },
    }, hasRoll ? "Usa 🎲" : "Usa"));
  }
  card.appendChild(actions);
  sheet.appendChild(card);
  document.body.appendChild(sheet);
}

function renderChoice(c, state, handlers) {
  const meetsReq = !c.requires || evalCondition(c.requires, state);
  const hasItems = !c.consume || c.consume.every(i => state.inventory.includes(i));
  const enabled = meetsReq && hasItems;

  const labelText = interpolate(c.label, state);
  const labelNode = el("span", { className: "choice-label-text" }, labelText);

  const meta = el("span", { className: "choice-meta" });
  if (c.check) {
    const stat = STAT_DISPLAY[c.check.stat] ?? c.check.stat;
    meta.appendChild(el("span", { className: "choice-check" },
      `🎲 ${stat} DC ${c.check.dc}`));
  }
  if (c.consume?.length) {
    meta.appendChild(el("span", { className: "choice-consume" },
      `consuma: ${formatItemList(c.consume)}`));
  }

  const btn = el("button", {
    className: `btn btn--choice${enabled ? "" : " btn--disabled"}`,
    onClick: enabled ? () => handlers.onChoice(c) : null,
  });
  btn.appendChild(labelNode);
  if (meta.childNodes.length > 0) btn.appendChild(meta);
  if (!enabled) {
    const reason = !hasItems
      ? `Manca: ${formatItemList(c.consume.filter(i => !state.inventory.includes(i)))}`
      : "Non disponibile";
    btn.setAttribute("disabled", "true");
    btn.appendChild(el("span", { className: "choice-disabled-reason" }, reason));
  }
  return btn;
}

function renderFeedEntry(entry) {
  if (entry.kind === "scenario") {
    return el("article", { className: "feed-entry feed-entry--scenario" },
      el("header", {}, el("span", { className: "month" }, `M${entry.turn}`), el("h3", {}, entry.title)),
      el("p", {}, entry.text),
    );
  }
  if (entry.kind === "choice") {
    return el("article", { className: "feed-entry feed-entry--choice" },
      el("span", { className: "month" }, `M${entry.turn}`),
      el("span", {}, "→ "),
      el("span", { className: "choice-label" }, entry.label),
    );
  }
  if (entry.kind === "event_choice") {
    return el("article", { className: "feed-entry feed-entry--choice feed-entry--event-choice" },
      el("span", { className: "month" }, `M${entry.turn}`),
      el("span", {}, "↪ "),
      el("span", { className: "choice-label" }, entry.label),
    );
  }
  if (entry.kind === "event") {
    return el("article", { className: "feed-entry feed-entry--event" },
      el("header", {}, el("span", { className: "month" }, `M${entry.turn}`), el("h4", {}, `Evento: ${entry.title}`)),
      el("p", {}, entry.text),
    );
  }
  if (entry.kind === "roll") {
    const stat = STAT_DISPLAY[entry.stat] ?? entry.stat;
    const kindLabels = {
      success: "SUCCESSO",
      failure: "FALLIMENTO",
      critical_success: "SUCCESSO CRITICO",
      critical_failure: "FALLIMENTO CRITICO",
    };
    const mod = entry.modifier >= 0 ? `+${entry.modifier}` : `${entry.modifier}`;
    const bonusStr = entry.bonus ? ` ${entry.bonus >= 0 ? "+" : ""}${entry.bonus}` : "";
    return el("article", { className: `feed-entry feed-entry--roll feed-entry--${entry.outcome}` },
      el("span", { className: "dice" }, "🎲"),
      el("span", { className: "roll-detail" },
        `1d20=${entry.d20} ${mod} (${stat})${bonusStr} = ${entry.total} vs DC ${entry.dc}`),
      el("span", { className: "roll-result" }, kindLabels[entry.outcome] ?? entry.outcome),
    );
  }
  if (entry.kind === "reaction") {
    const from = FACTION_DISPLAY[entry.from] ?? entry.from ?? "";
    return el("article", { className: "feed-entry feed-entry--reaction" },
      el("header", {},
        el("span", { className: "month" }, `M${entry.turn}`),
        el("span", { className: "reaction-from" }, from)),
      el("p", {}, entry.text),
    );
  }
  if (entry.kind === "consume") {
    return el("article", { className: "feed-entry feed-entry--consume" },
      el("span", { className: "month" }, `M${entry.turn}`),
      el("span", {}, `– ${formatItemList(entry.items)} (consumato)`),
    );
  }
  if (entry.kind === "delta") {
    const wrap = el("article", { className: "feed-entry feed-entry--delta" });
    for (const c of entry.changes) {
      let display;
      let cls = c.delta > 0 ? "delta-pos" : "delta-neg";
      if (c.kind === "stat") {
        const sign = c.delta > 0 ? "+" : "";
        display = `${sign}${c.delta} ${STAT_DISPLAY[c.key] ?? c.key}`;
      } else if (c.kind === "reputation") {
        const sign = c.delta > 0 ? "+" : "";
        display = `${sign}${c.delta} ${FACTION_DISPLAY[c.key] ?? c.key}`;
      } else if (c.kind === "inventory") {
        display = `${c.delta > 0 ? "+" : "−"} ${formatItemName(c.key)}`;
      } else if (c.kind === "flag") {
        if (c.delta > 0) {
          display = `🏷 ${formatItemName(c.key)}`;
          cls = "delta-flag";
        } else {
          // Flag removed — a redemption beat. Cross it out with a strikethrough
          // and pair it with a checkmark for the "shed the weight" UX read.
          display = `✓ ${formatItemName(c.key)}`;
          cls = "delta-flag-removed";
        }
      }
      if (display) wrap.appendChild(el("span", { className: `delta-chip ${cls}` }, display));
    }
    return wrap;
  }
  if (entry.kind === "item_used") {
    return el("article", { className: "feed-entry feed-entry--item-used" },
      el("span", { className: "month" }, `M${entry.turn}`),
      el("span", {}, `Hai usato: ${entry.itemName}`),
    );
  }
  if (entry.kind === "ending") {
    const wrap = el("article", { className: "feed-entry feed-entry--ending" },
      el("header", {}, el("h2", {}, entry.title), el("div", { className: "perish-cause" }, entry.cause)),
      el("p", {}, entry.text),
    );

    // "Cosa ti ha portato qui" — the post-mortem.
    if (Array.isArray(entry.reasons) && entry.reasons.length > 0) {
      const expl = el("div", { className: "ending-explanation" },
        el("h4", {}, "Cosa ti ha portato qui"));
      if (entry.summary) {
        expl.appendChild(el("p", { className: "ending-summary" },
          el("strong", {}, "Causa principale: "), entry.summary));
      }
      const list = el("ul", { className: "reasons" });
      for (const r of entry.reasons) {
        list.appendChild(el("li", { className: `reason reason--${r.kind}` }, r.text));
      }
      expl.appendChild(list);

      // Final state snapshot
      if (entry.finalSnapshot) {
        const snap = entry.finalSnapshot;
        const sb = el("div", { className: "final-snapshot" });
        sb.appendChild(el("h5", {}, "Stato finale"));
        const statLine = Object.entries(snap.stats)
          .map(([k, v]) => `${(STAT_DISPLAY[k] ?? k).slice(0,3)} ${v}`).join("  ·  ");
        sb.appendChild(el("div", { className: "snapshot-row" }, statLine));
        const repLine = Object.entries(snap.reputation)
          .map(([k, v]) => `${(FACTION_DISPLAY[k] ?? k).slice(0,12)} ${v >= 0 ? "+" : ""}${v}`).join("  ·  ");
        sb.appendChild(el("div", { className: "snapshot-row snapshot-rep" }, repLine));
        sb.appendChild(el("div", { className: "snapshot-row snapshot-meta" },
          `${snap.turn} mesi  ·  ${snap.scenariosSeen} scenari giocati  ·  ${snap.eventsFired} eventi  ·  ${snap.milestones} milestone`));
        expl.appendChild(sb);
      }

      // Moral / framing line
      expl.appendChild(el("p", { className: "ending-moral" },
        "Il finale è la somma delle tue scelte, ma il sistema che le ha vincolate non l'hai scelto tu."));

      wrap.appendChild(expl);
    }

    if (Array.isArray(entry.resources) && entry.resources.length > 0) {
      const res = el("div", { className: "crisis-resources" },
        el("h4", {}, "Risorse"),
        el("p", { className: "resources-intro" },
          "Questo finale rappresenta il fallimento di un sistema, non tuo. Se quello che hai letto risuona con un'esperienza reale, non sei solo/a:"));
      const ul = el("ul", {});
      for (const r of entry.resources) {
        ul.appendChild(el("li", {}, `${r.name} — ${r.contact}${r.note ? ` (${r.note})` : ""}`));
      }
      res.appendChild(ul);
      wrap.appendChild(res);
    }
    return wrap;
  }
  return el("article", {});
}

function formatItemName(s) {
  return s.replace(/_/g, " ");
}
