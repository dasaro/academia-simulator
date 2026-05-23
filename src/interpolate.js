// Text interpolation for scenario / choice / reaction / event / ending text.
// Used by both the engine (when pushing entries to the feed) and the UI
// (when rendering state-picker hints and choice buttons). Keeping a single
// implementation here avoids the bug where one copy knows about
// `{contract_long}` and the other doesn't — which is what shipped before
// this module existed.
//
// Supported tokens:
//   {m|f}        — gender form (male | female)
//   {m|f|nb}     — gender form with optional non-binary fallback
//   {ssd}        — character's SSD (e.g. "MAT/03")
//   {name}       — character's display name
//   {contract_short}   — short label: PON / PNRR / MSCA / FFO / assegno / contratto
//   {contract_long}    — definite phrase: "il tuo PON" / "la tua MSCA" / "il tuo assegno"
//   {Contract_long}    — capitalised form for sentence starts
//   {contract_full}    — full descriptor: "RTD-A PON" / "assegno di ricerca" / "contratto a tempo determinato"
//   {job_role}         — what the player is: "RTD-A" / "assegnista" / "contrattista"

const CONTRACT_PHRASES = {
  PON:          { short: "PON",       long: "il tuo PON",                  full: "RTD-A PON",                       role: "RTD-A" },
  PNRR:         { short: "PNRR",      long: "il tuo PNRR",                 full: "RTD-A PNRR",                      role: "RTD-A" },
  MSCA:         { short: "MSCA",      long: "la tua MSCA",                 full: "MSCA / Marie Curie",              role: "RTD-A MSCA" },
  FFO:          { short: "FFO",       long: "il tuo contratto FFO",        full: "RTD-A su FFO d'ateneo",           role: "RTD-A" },
  POSTDOC:      { short: "assegno",   long: "il tuo assegno",              full: "assegno di ricerca",              role: "assegnista" },
  CONTRATTISTA: { short: "contratto", long: "il tuo contratto a termine",  full: "contratto a tempo determinato",   role: "contrattista" },
};

function contractPhrase(state, key) {
  const ct = state?.character?.contractType ?? "PON";
  return (CONTRACT_PHRASES[ct] ?? CONTRACT_PHRASES.PON)[key] ?? "";
}

function capitalize(s) {
  return typeof s === "string" && s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export function interpolate(s, state) {
  if (typeof s !== "string" || !state?.character) return s;
  const g = state.character.gender ?? "m";
  return s
    .replace(/\{([^{}|]*)\|([^{}|]*)(?:\|([^{}|]*))?\}/g, (_, m, f, nb) => {
      if (g === "f") return f;
      if (g === "nb") return nb ?? m;
      return m;
    })
    .replace(/\{contract_short\}/g, contractPhrase(state, "short"))
    .replace(/\{contract_long\}/g,  contractPhrase(state, "long"))
    .replace(/\{Contract_long\}/g,  capitalize(contractPhrase(state, "long")))
    .replace(/\{contract_full\}/g,  contractPhrase(state, "full"))
    .replace(/\{job_role\}/g,       contractPhrase(state, "role"))
    .replace(/\{ssd\}/g, state.character.ssd ?? "")
    .replace(/\{name\}/g, state.character.name ?? "");
}
