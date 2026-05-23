// Post-mortem generator: trace which sub-clauses of the ending's condition
// matched and surface them as human-readable bullets. Used by the engine to
// attach a "Cosa ti ha portato qui" panel to the ending feed entry.

import { evalCondition } from "./conditions.js";

// Italian gloss for flags that appear in ending conditions. The engine's
// MILESTONE_FLAGS map handles the long-form titles for narrative pivots; this
// map catches the secondary ones (warning-sign flags, passive-default markers).
const FLAG_GLOSS = {
  // Active narrative pivots (also in engine MILESTONE_FLAGS)
  candidato_pi_prin: "Ti sei candidato/a come PI del PRIN",
  prin_associato: "Hai partecipato al PRIN come associato/a",
  sfida_barone: "Hai sfidato il Barone in un concorso",
  cordata_barone: "Sei entrato/a nella cordata del Barone",
  fuggito_estero: "Sei partito/a all'estero",
  pers_estero_da_solo: "Sei andato/a all'estero da solo/a",
  pers_estero_famiglia: "Sei andato/a all'estero con la famiglia",
  lavoro_in_maternita: "Hai lavorato durante la maternità",
  pers_recupero_maternita: "Hai accettato il «recupero» post-parto",
  pers_gravidanza_rischio: "Gravidanza a rischio non protetta dall'ateneo",
  dimissionato: "Hai firmato le dimissioni",
  pers_dimissionato: "Hai firmato le dimissioni",
  fund_dimissione_pon: "Ti sei dimesso/a anticipando la scadenza PON",
  pers_uscito_industria: "Sei passato/a all'industria",
  work_smart_aziendale: "Hai accettato lo smart aziendale",
  pers_burnout_clinico: "Hai ricevuto una diagnosi di burnout",
  pers_terapia_interrotta: "Hai interrotto la terapia",
  pers_in_terapia: "Avevi iniziato la psicoterapia",
  pers_emicrania_cronica: "Soffrivi di emicrania cronica",
  pers_mutuo_negato: "La banca ti ha negato il mutuo",
  pers_partner_lontano: "Il/La tuo/a partner si è trasferito/a lontano",
  pers_caregiver: "Sei diventato/a caregiver di un familiare",
  pers_naspi: "Sei finito/a in NASpI",
  pers_silenzio_dolore: "Hai stretto i denti senza chiedere aiuto",
  pers_silenzio_famiglia: "Non hai detto niente alla famiglia",
  pers_malattia_finta: "Hai lavorato durante una falsa malattia",
  asn_bocciato: "Sei stato/a bocciato/a all'ASN",
  career_bocciato_asn: "Sei stato/a bocciato/a all'ASN",
  career_rassegnato_asn: "Ti sei rassegnato/a sull'ASN",
  career_sfida_concorso_cucito: "Hai sfidato un concorso «cucito»",
  career_silent_exit: "Hai scelto l'uscita silenziosa",
  career_rassegnato_sistema: "Ti sei rassegnato/a al sistema",
  career_resistenza_passiva: "Hai scelto la resistenza passiva",
  career_sfruttamento_cronico: "Hai accettato lo sfruttamento cronico",
  career_attesa_obbediente: "Hai aspettato in silenzio",
  career_attesa_promessa: "Ti sei fidato/a delle promesse di rinnovo",
  career_monografia_ombra: "Hai pubblicato in editoria predatoria",
  career_pubblicazione_mdpi: "Hai pubblicato su MDPI «al volo»",
  career_attivismo_pubblico: "Sei diventato/a attivista visibile",
  career_impugna_criteri: "Hai impugnato i criteri di un concorso",
  career_meditazione_vendetta: "Hai meditato vendetta nel SSD",
  career_nemico_locale: "Ti sei fatto/a un nemico locale",
  career_responsabile_offeso: "Hai offeso il tuo responsabile",
  career_favore_politico: "Hai accettato un favore politico",
  career_ricorso_tar_titoli: "Hai fatto ricorso al TAR sui titoli",
  career_ricorso_seriale: "Sei un/a ricorrente seriale al TAR",
  burocr_diffida_tar: "Hai diffidato l'ateneo (TAR)",
  burocr_diffida_proroga: "Hai diffidato l'ateneo per la proroga",
  burocr_avvocato_privato: "Ti sei rivolto/a a un avvocato privato",
  burocr_sindacato_attivato: "Hai attivato il sindacato",
  burocr_lettera_collettiva: "Hai firmato la lettera collettiva",
  burocr_vertenza_addizionali: "Hai aperto una vertenza per addizionali",
  burocr_recupero_subito: "Hai subito un recupero forzato",
  burocr_silenzio_assenso: "Ti sei fidato/a del silenzio-assenso",
  fund_causa_ateneo: "Hai fatto causa all'ateneo",
  fund_accattonaggio: "Hai chiesto fondi a chiunque",
  fund_recupero_intensivo: "Hai subito un recupero intensivo",
  fund_msca_candidato: "Ti sei candidato/a a MSCA",
  fund_erc_candidato: "Ti sei candidato/a a ERC",
  work_telematica_si: "Hai accettato un posto alla telematica",
  riforma_in_arrivo: "Una riforma del reclutamento è arrivata",
  passivo: "Sei stato/a passivo/a",
  attivista_visibile: "Sei riconoscibile come attivista",
  non_ho_capito_niente: "Hai annuito senza capire",
  progetto_fantasma: "Lavoravi su un progetto fantasma",
  rendiconto_in_ritardo: "Eri sempre in ritardo coi rendiconti",
  complesso_inferiorita: "Ti pesava la sindrome dell'impostore",
  pec_aperta: "Avevi una PEC al MUR senza risposta",
  grp_lettera_firmata: "Hai firmato la lettera collettiva del gruppo",
  grp_visibilita_stampa: "Sei finito/a sui giornali",
};

const STAT_DISPLAY = {
  intelligenza: "Intelligenza", networking: "Networking", stamina: "Stamina",
  burocrazia: "Burocrazia", fondi: "Fondi", persuasione: "Persuasione",
};
const FACTION_DISPLAY = {
  supervisor: "il/la Responsabile", peers: "gli Altri Precari", barone: "il Barone",
  mur: "il MUR", ateneo_hr: "l'Ufficio Risorse Umane",
};

function glossFlag(f) {
  return FLAG_GLOSS[f] ?? f.replace(/_/g, " ");
}

function formatNumericOp(op, val) {
  switch (op) {
    case "lte": return `≤ ${val}`;
    case "gte": return `≥ ${val}`;
    case "lt":  return `< ${val}`;
    case "gt":  return `> ${val}`;
    case "eq":  return `= ${val}`;
    default:    return `${op} ${val}`;
  }
}

// Walk the condition tree and collect the sub-clauses that the state
// actually matched. Returns an array of { kind, text } reasons, deduped.
export function explainEnding(ending, state) {
  const reasons = [];
  const seen = new Set();
  function push(kind, text) {
    const key = `${kind}::${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push({ kind, text });
  }

  function walk(cond) {
    if (!cond) return;
    if (cond.all) { cond.all.forEach(walk); }
    if (cond.any) {
      // For `any`, only surface the first sub-branch that matches — avoid
      // listing every alternative.
      const matched = cond.any.find((c) => evalCondition(c, state));
      if (matched) walk(matched);
    }

    // Flags
    const fs = cond.flags;
    if (fs) {
      const spec = Array.isArray(fs) ? { has: fs } : fs;
      if (spec.has) {
        for (const f of spec.has) {
          if (state.flags.includes(f)) push("flag", glossFlag(f));
        }
      }
      if (spec.hasAny) {
        // Surface only the first present member — the OR is "any one of these
        // counts" so don't dump the whole list.
        for (const f of spec.hasAny) {
          if (state.flags.includes(f)) { push("flag", glossFlag(f)); break; }
        }
      }
      if (spec.hasNot) {
        // Only surface if the absence is *narratively significant* — for
        // pi_catch22 the absence of PI flags is the whole point.
        const allAbsent = spec.hasNot.every((f) => !state.flags.includes(f));
        if (allAbsent && spec.hasNot.length <= 4) {
          push("flag_absent", `Non ti sei mai candidato/a: ${spec.hasNot.map(glossFlag).join(", ")}`);
        }
      }
    }

    // Inventory presence is a decision marker too
    const inv = cond.inventory;
    if (inv) {
      const spec = Array.isArray(inv) ? { has: inv } : inv;
      if (spec.has) {
        for (const it of spec.has) {
          if (state.inventory.includes(it)) push("inventory", `Inventario: ${it.replace(/_/g, " ")}`);
        }
      }
    }

    // Stats
    if (cond.stats) {
      for (const [stat, spec] of Object.entries(cond.stats)) {
        const v = state.stats[stat] ?? 0;
        if (typeof spec === "number") {
          push("stat", `${STAT_DISPLAY[stat] ?? stat}: ${v} (richiesto = ${spec})`);
        } else {
          for (const [op, target] of Object.entries(spec)) {
            push("stat", `${STAT_DISPLAY[stat] ?? stat}: ${v} (${formatNumericOp(op, target)})`);
          }
        }
      }
    }

    // Reputation
    if (cond.reputation) {
      for (const [fac, spec] of Object.entries(cond.reputation)) {
        const v = state.reputation[fac] ?? 0;
        if (typeof spec === "number") {
          push("reputation", `Reputazione con ${FACTION_DISPLAY[fac] ?? fac}: ${v} (richiesto = ${spec})`);
        } else {
          for (const [op, target] of Object.entries(spec)) {
            push("reputation", `Reputazione con ${FACTION_DISPLAY[fac] ?? fac}: ${v} (${formatNumericOp(op, target)})`);
          }
        }
      }
    }

    // Time
    if (cond.minTurn !== undefined) {
      push("time", `${state.turn} mesi di carriera`);
    }
  }

  walk(ending.condition);
  return reasons;
}

// One-line "lesson" extracted from the most distinctive matched reason — used
// in the explanation card's header. Falls back to the ending's own perishCause.
export function summarizeReasons(reasons, ending) {
  const flagReason = reasons.find((r) => r.kind === "flag");
  if (flagReason) return flagReason.text;
  const absentReason = reasons.find((r) => r.kind === "flag_absent");
  if (absentReason) return absentReason.text;
  return ending.perishCause;
}
