// Renderer avatar SVG vanilla. Niente librerie, niente immagini esterne:
// l'avatar è costruito proceduralmente da parti SVG componibili. Stile
// piatto, geometrico, leggermente satirico — coerente col tono del gioco.
//
// API:
//   renderAvatar(config, mood, size) → SVGSVGElement
//
// Dove:
//   config = { hair, hairColor, shirt, shirtColor, skin }
//   mood   = "neutral" | "happy" | "tired" | "stressed" | "crisis"
//   size   = pixel size (default 80)
//
// `hair` è uno degli stili in HAIR_STYLES, gli altri sono indici nelle
// palette. Indici fuori range fanno fallback a 0.

// ----------------------------------------------------------------- palette
export const SKIN_TONES = [
  "#f5d4b1",  // 0 — chiara
  "#e8c5a0",  // 1 — chiara/media
  "#c89a76",  // 2 — media
  "#8d5524",  // 3 — scura
  "#5a3a1f",  // 4 — molto scura
];
export const HAIR_COLORS = [
  "#1c1c1c",  // 0 — nero
  "#3a2418",  // 1 — castano scuro
  "#6b4423",  // 2 — castano
  "#a07845",  // 3 — biondo scuro
  "#d4b27a",  // 4 — biondo
  "#dcd9d6",  // 5 — grigio/bianco
];
export const SHIRT_COLORS = [
  "#385170",  // 0 — blu
  "#5a8a3a",  // 1 — verde
  "#a04545",  // 2 — rosso
  "#bc8a2f",  // 3 — senape
  "#454545",  // 4 — grigio scuro
  "#7a4f9a",  // 5 — viola
];

export const HAIR_STYLE_LABELS = {
  short_m:  "Corti — taglio corto",
  short_f:  "Cortissimi — caschetto",
  long_f:   "Lunghi",
  curly:    "Ricci",
  bald:     "Calvo/Rasati",
};

// ----------------------------------------------------------------- utilities
const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c) el.appendChild(c);
  }
  return el;
}

function path(d, fill = "none", stroke = null, strokeWidth = 1.6) {
  const attrs = { d };
  if (fill && fill !== "none") attrs.fill = fill;
  else attrs.fill = "none";
  if (stroke) {
    attrs.stroke = stroke;
    attrs["stroke-width"] = strokeWidth;
    attrs["stroke-linecap"] = "round";
    attrs["stroke-linejoin"] = "round";
  }
  return svgEl("path", attrs);
}

// ----------------------------------------------------------------- shapes
// Tutto disegnato su viewBox 0 0 80 80. La testa è circa al centro-alto,
// le spalle in basso. Le orecchie spuntano lateralmente alla testa.

function shirt(color, style) {
  // Trapezio dal collo alle spalle/petto. Stile può variare il taglio.
  if (style === "v") {
    // Scollo a V
    return path("M 15 80 L 20 56 Q 30 58 40 64 Q 50 58 60 56 L 65 80 Z", color);
  }
  if (style === "dress") {
    // Vestito (forma a campana)
    return path("M 12 80 L 20 54 L 60 54 L 68 80 Z", color);
  }
  // Default: maglietta a girocollo
  return path("M 15 80 L 22 56 L 58 56 L 65 80 Z", color);
}

function collarStripe(color) {
  // Striscia chiara sul colletto per dare profondità
  return svgEl("path", {
    d: "M 22 56 Q 40 60 58 56",
    stroke: color,
    "stroke-width": "1.2",
    fill: "none",
    opacity: "0.5",
  });
}

function neck(skin) {
  // Collo che collega testa a maglietta
  return svgEl("rect", { x: 35, y: 48, width: 10, height: 10, fill: skin });
}

function ears(skin) {
  return [
    svgEl("circle", { cx: 22, cy: 34, r: 3, fill: skin }),
    svgEl("circle", { cx: 58, cy: 34, r: 3, fill: skin }),
  ];
}

function head(skin) {
  // Testa leggermente ovale per un look meno cartoonesco
  return svgEl("ellipse", { cx: 40, cy: 32, rx: 18, ry: 20, fill: skin });
}

// ----------------------------------------------------------------- hair
// Ogni stile è una funzione (hairColor) → SVGElement. Disegnata sopra la
// testa, può estendersi lateralmente o coprire la fronte.
const HAIR_STYLES = {
  // capelli corti maschili — bordo netto sulla fronte, sui lati arriva
  // sopra le orecchie
  short_m: (c) => path(
    "M 22 28 Q 22 14 40 13 Q 58 14 58 28 L 58 34 Q 56 24 50 22 L 30 22 Q 24 24 22 34 Z",
    c
  ),

  // taglio corto femminile / caschetto — copre orecchie, leggera fronte
  short_f: (c) => path(
    "M 20 30 Q 20 12 40 11 Q 60 12 60 30 L 60 42 L 56 42 L 56 30 Q 54 24 48 22 L 32 22 Q 26 24 24 30 L 24 42 L 20 42 Z",
    c
  ),

  // capelli lunghi — scendono fino alle spalle
  long_f: (c) => path(
    "M 18 30 Q 18 12 40 11 Q 62 12 62 30 L 62 58 L 56 58 L 56 32 Q 54 24 48 22 L 32 22 Q 26 24 24 32 L 24 58 L 18 58 Z",
    c
  ),

  // capelli ricci — cluster di cerchi sopra la testa
  curly: (c) => svgEl("g", {}, [
    svgEl("circle", { cx: 25, cy: 22, r: 5, fill: c }),
    svgEl("circle", { cx: 32, cy: 17, r: 5.5, fill: c }),
    svgEl("circle", { cx: 40, cy: 14, r: 6, fill: c }),
    svgEl("circle", { cx: 48, cy: 17, r: 5.5, fill: c }),
    svgEl("circle", { cx: 55, cy: 22, r: 5, fill: c }),
    svgEl("circle", { cx: 22, cy: 28, r: 4, fill: c }),
    svgEl("circle", { cx: 58, cy: 28, r: 4, fill: c }),
  ]),

  // calvo — niente, ma con un ombra sottile per profondità
  bald: () => svgEl("ellipse", {
    cx: 40, cy: 18, rx: 12, ry: 4,
    fill: "#000",
    opacity: "0.08",
  }),
};

// ----------------------------------------------------------------- mood
// Occhi e bocca cambiano in base al mood. Le sopracciglia compaiono
// solo nei mood "stressed" e "crisis".

const INK = "#1c1c1c";

const EYES = {
  neutral: () => svgEl("g", {}, [
    svgEl("circle", { cx: 33, cy: 32, r: 1.8, fill: INK }),
    svgEl("circle", { cx: 47, cy: 32, r: 1.8, fill: INK }),
  ]),
  happy: () => svgEl("g", {}, [
    path("M 30 33 Q 33 28 36 33", "none", INK, 1.8),
    path("M 44 33 Q 47 28 50 33", "none", INK, 1.8),
  ]),
  tired: () => svgEl("g", {}, [
    // occhi semichiusi
    path("M 30 33 L 36 33", "none", INK, 1.8),
    path("M 44 33 L 50 33", "none", INK, 1.8),
    // borse sotto gli occhi
    path("M 30 36 Q 33 38 36 36", "none", INK, 0.8),
    path("M 44 36 Q 47 38 50 36", "none", INK, 0.8),
  ]),
  stressed: () => svgEl("g", {}, [
    svgEl("circle", { cx: 33, cy: 32, r: 1.8, fill: INK }),
    svgEl("circle", { cx: 47, cy: 32, r: 1.8, fill: INK }),
    // sopracciglia aggrottate
    path("M 28 27 L 36 29.5", "none", INK, 1.8),
    path("M 52 27 L 44 29.5", "none", INK, 1.8),
  ]),
  crisis: () => svgEl("g", {}, [
    // occhi a X
    path("M 30 30 L 36 34 M 30 34 L 36 30", "none", INK, 1.8),
    path("M 44 30 L 50 34 M 44 34 L 50 30", "none", INK, 1.8),
  ]),
};

const MOUTH = {
  neutral:  () => path("M 36 42 L 44 42", "none", INK, 1.6),
  happy:    () => path("M 33 40 Q 40 47 47 40", "none", INK, 1.8),
  tired:    () => path("M 36 43 L 44 43", "none", INK, 1.4),
  stressed: () => path("M 34 44 Q 40 41 46 44", "none", INK, 1.6),
  crisis:   () => svgEl("ellipse", {
    cx: 40, cy: 43, rx: 2.5, ry: 3.5,
    fill: INK,
  }),
};

// ----------------------------------------------------------------- compose

export function renderAvatar(config = {}, mood = "neutral", size = 80) {
  const skin = SKIN_TONES[clampIdx(config.skin, SKIN_TONES.length)];
  const hairColor = HAIR_COLORS[clampIdx(config.hairColor, HAIR_COLORS.length)];
  const shirtColor = SHIRT_COLORS[clampIdx(config.shirt, SHIRT_COLORS.length)];
  const shirtStyle = config.shirtStyle ?? "default";
  const hairStyle = HAIR_STYLES[config.hair] ? config.hair : "short_m";
  const moodKey = EYES[mood] ? mood : "neutral";

  const svg = svgEl("svg", {
    viewBox: "0 0 80 80",
    width: size, height: size,
    class: "avatar-svg",
    role: "img",
    "aria-label": `Avatar (${moodKey})`,
  });

  // Z-order conta: maglietta dietro, poi collo, orecchie, testa, capelli,
  // viso (occhi+bocca). Le orecchie devono spuntare dietro ai capelli
  // ricci/lunghi per realismo.
  svg.appendChild(shirt(shirtColor, shirtStyle));
  svg.appendChild(collarStripe("#000"));
  svg.appendChild(neck(skin));
  for (const e of ears(skin)) svg.appendChild(e);
  svg.appendChild(head(skin));
  svg.appendChild(HAIR_STYLES[hairStyle](hairColor));
  svg.appendChild(EYES[moodKey]());
  svg.appendChild(MOUTH[moodKey]());

  return svg;
}

function clampIdx(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= max) return 0;
  return Math.floor(n);
}

// ----------------------------------------------------------------- NPC preset
// Avatar fissi per le figure ricorrenti del gioco. Ogni reaction `from: X`
// può pescare il preset corrispondente e renderlo accanto al testo.
// Stereotipi consapevoli: il barone è un uomo anziano grigio in giacca; il
// sindacato è un uomo con capelli ricci e felpa rossa; ecc. Sono caricature,
// non descrizioni — coerente col tono satirico del gioco.
export const NPC_AVATARS = {
  supervisor: {
    config: { hair: "short_m", hairColor: 5, shirt: 0, skin: 1, shirtStyle: "v" },
    defaultMood: "neutral",
    label: "Il/la responsabile",
  },
  direttore_dipartimento: {
    config: { hair: "bald", hairColor: 5, shirt: 4, skin: 2, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "Direttore di dipartimento",
  },
  barone: {
    config: { hair: "short_m", hairColor: 5, shirt: 4, skin: 1, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "Il Barone",
  },
  mur: {
    config: { hair: "short_m", hairColor: 1, shirt: 4, skin: 1, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "MUR",
  },
  ateneo_hr: {
    config: { hair: "long_f", hairColor: 1, shirt: 5, skin: 1, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "Ufficio personale d'ateneo",
  },
  peers: {
    config: { hair: "short_f", hairColor: 2, shirt: 1, skin: 1, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "Colleghi/e precari",
  },
  sindacato: {
    config: { hair: "curly", hairColor: 1, shirt: 2, skin: 1, shirtStyle: "default" },
    defaultMood: "neutral",
    label: "Sindacato",
  },
};

export function renderNpcAvatar(faction, mood, size = 48) {
  const preset = NPC_AVATARS[faction];
  if (!preset) return null;
  return renderAvatar(preset.config, mood ?? preset.defaultMood, size);
}

export function npcLabel(faction) {
  return NPC_AVATARS[faction]?.label ?? faction;
}

// ----------------------------------------------------------------- mood deriv
// Mappa stato → mood del player. Chiamata al render per fare in modo che
// l'avatar nel sidebar / mobile bar mostri lo "stato d'animo" del momento.
//
// Priorità (alta → bassa):
//   1. Flag di crisi conclamata    → crisis
//   2. Flag di burnout o terapia    → tired
//   3. Stamina ≤ 1                  → tired
//   4. Stamina ≤ 3 o rep media ≤ -3 → stressed
//   5. Stamina ≥ 8 e rep media ≥ 3  → happy
//   6. Altrimenti                   → neutral
const CRISIS_FLAGS = new Set([
  "pers_burnout_clinico",
  "pers_crisi_psicotica",
  "pers_ricovero_psichiatrico",
  "pers_tentato_suicidio",
  "pers_panico_clinico",
]);
const TIRED_FLAGS = new Set([
  "pers_in_terapia",
  "pers_emicrania_cronica",
  "pers_caregiver",
  "lezione_senza_voce",
  "neurologo_privato",
  "natale_revisione_subito",
  "domenica_outlook_aperto",
]);

export function derivePlayerMood(state) {
  if (!state) return "neutral";
  const flags = state.flags ?? [];
  for (const f of flags) {
    if (CRISIS_FLAGS.has(f)) return "crisis";
  }
  for (const f of flags) {
    if (TIRED_FLAGS.has(f)) return "tired";
  }
  const stamina = state.stats?.stamina ?? 5;
  if (stamina <= 1) return "tired";

  const reps = Object.values(state.reputation ?? {});
  const repAvg = reps.length > 0 ? reps.reduce((a, b) => a + b, 0) / reps.length : 0;

  if (stamina <= 3 || repAvg <= -3) return "stressed";
  if (stamina >= 8 && repAvg >= 3) return "happy";
  return "neutral";
}

// ----------------------------------------------------------------- reaction mood
// Dato il `reputation` delta della reazione (se conosciuto), inferisce il
// mood del NPC. Se la reaction ha aumentato la sua reputazione → happy.
// Se l'ha diminuita → stressed (è arrabbiato/a). Altrimenti neutral.
export function reactionMood(reactionFrom, deltaForFaction) {
  if (typeof deltaForFaction !== "number") return "neutral";
  if (deltaForFaction >= 2) return "happy";
  if (deltaForFaction >= 1) return "neutral";
  if (deltaForFaction <= -2) return "stressed";
  if (deltaForFaction <= -1) return "stressed";
  return "neutral";
}
