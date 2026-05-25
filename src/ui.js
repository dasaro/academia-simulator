// Vanilla DOM rendering. No framework, no virtual DOM. Re-renders the whole
// screen on each state change — the game is small enough that this is fine.

import { evalCondition } from "./conditions.js";
import { interpolate } from "./interpolate.js";
import {
  renderAvatar, renderNpcAvatar, npcLabel,
  derivePlayerMood, reactionMood,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, HAIR_STYLE_LABELS,
} from "./avatar.js";
import { getAnnotation, hasAnnotations } from "./annotations.js";

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

// Badge ℹ accanto al titolo: cliccato apre un popup con le anchor.
// Visibile solo se data/annotations.json esiste (locale, gitignored).
// Su GitHub Pages annotations.json non esiste → nessun badge.
function renderAnchorBadge(kind, id) {
  if (!hasAnnotations()) return null;
  const ann = getAnnotation(kind, id);
  if (!ann) return null;
  const btn = document.createElement("button");
  btn.className = "anchor-badge";
  btn.type = "button";
  btn.title = "Anchor (visibile solo in locale)";
  btn.textContent = "ℹ";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showAnchorPanel(id, ann);
  });
  return btn;
}

function showAnchorPanel(id, ann) {
  // Rimuovi pannello esistente, se c'è
  document.querySelectorAll(".anchor-panel").forEach(p => p.remove());
  const panel = document.createElement("div");
  panel.className = "anchor-panel";
  panel.innerHTML = "";
  const close = () => panel.remove();
  panel.addEventListener("click", (e) => { if (e.target === panel) close(); });

  const card = document.createElement("div");
  card.className = "anchor-panel__card";

  const header = document.createElement("header");
  header.className = "anchor-panel__header";
  header.innerHTML = `<h3>🔖 Anchor — <code>${id}</code></h3>
    <button class="anchor-panel__close" type="button" aria-label="Chiudi">✕</button>`;
  header.querySelector(".anchor-panel__close").addEventListener("click", close);
  card.appendChild(header);

  if (ann.notes) {
    const notes = document.createElement("p");
    notes.className = "anchor-panel__notes";
    notes.textContent = ann.notes;
    card.appendChild(notes);
  }

  if (Array.isArray(ann.anchors)) {
    const list = document.createElement("div");
    list.className = "anchor-panel__list";
    for (const a of ann.anchors) {
      const item = document.createElement("div");
      item.className = `anchor-item anchor-item--${a.source}`;
      const tag = document.createElement("span");
      tag.className = "anchor-item__tag";
      tag.textContent = a.source === "chat" ? "📞 chat"
                      : a.source === "esterno" ? "🌐 esterno"
                      : a.source === "user_personal" ? "👤 personale"
                      : a.source;
      const ref = document.createElement("div");
      ref.className = "anchor-item__ref";
      ref.textContent = a.ref;
      const quote = document.createElement("blockquote");
      quote.className = "anchor-item__quote";
      quote.textContent = a.quote || "";
      item.appendChild(tag);
      item.appendChild(ref);
      if (a.quote) item.appendChild(quote);
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  const footer = document.createElement("footer");
  footer.className = "anchor-panel__footer";
  footer.textContent = "Questo pannello è visibile solo in locale (data/annotations.json è gitignored).";
  card.appendChild(footer);

  panel.appendChild(card);
  document.body.appendChild(panel);
}

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

const MOOD_LABEL = {
  neutral:  "in equilibrio",
  happy:    "vai forte",
  tired:    "stanc{o|a}",
  stressed: "sotto pressione",
  crisis:   "crisi",
};

// FLAG_DISPLAY — solo i flag in questa mappa appaiono nel dossier.
// Ogni voce: { label, cat, hint }
//   label: stringa user-facing (con interpolazione {o|a} per gender)
//   cat:   categoria visuale (tratto/politica/salute/procedure/conseguenze/famiglia/carriera/rete)
//   hint:  spiegazione hover sull'effetto gameplay
// Tutti i flag tecnici (gender, contract, age, stance, orientation, is_rtda...)
// e tutti i flag NON mappati vengono nascosti.
const FLAG_DISPLAY = {
  // ── Tratti del personaggio (innati) ─────────────────────────────────
  "burnout_prone":         { label: "Incline al burnout",   cat: "tratto",     hint: "La stamina scende più rapidamente quando il sistema preme." },
  "lone_wolf":             { label: "Solitari{o|a}",         cat: "tratto",     hint: "Pubblichi spesso da sol{o|a}. Networking debole, lavoro denso." },
  "cordata_friendly":      { label: "Predisposto al gruppo", cat: "tratto",     hint: "Hai network naturale. Sblocchi più scelte 'di cordata'." },
  "wetlab_chained":        { label: "Vincolat{o|a} al lab",  cat: "tratto",     hint: "Il laboratorio detta i tempi: poca libertà oraria, dipendenza dai materiali." },
  "mediane_in_pericolo":   { label: "Mediane a rischio",     cat: "tratto",     hint: "Settore non-bibliometrico: ASN incerta, monografia obbligata." },
  "industria_offre_sempre":{ label: "Industria ti corteggia",cat: "tratto",     hint: "Recruiter ti scrivono spesso. La porta verso il privato è sempre aperta." },
  "genitore":              { label: "Genitore",              cat: "tratto",     hint: "Hai un* figli* piccol*. Sblocca scenari nido/maternità/conciliazione." },
  "nido_in_lista_attesa":  { label: "In lista d'attesa nido",cat: "tratto",     hint: "Il nido universitario non esiste o non basta. Costo babysitter alle spalle." },

  // ── Posizione politica ──────────────────────────────────────────────
  "cordata_barone":            { label: "Cordata del Barone",        cat: "politica", hint: "Sei nel giro. Alcuni concorsi ti si aprono. Costo: l'autonomia." },
  "sfida_barone":              { label: "Hai sfidato il Barone",     cat: "politica", hint: "Hai detto no a una mossa di filiera. Conseguenze a medio termine." },
  "career_nemico_locale":      { label: "Nemic{o|a} del Barone",     cat: "politica", hint: "Sei nella lista. Concorsi locali bloccati. Solidarietà peer aumentata." },
  "attivista_visibile":        { label: "Attivista riconosciut{o|a}",cat: "politica", hint: "Firmi lettere, parli in consiglio. Sblocca rete sindacale. Il direttore ti tiene d'occhio." },
  "stance_resistant":          { label: "Militante",                 cat: "politica", hint: "Lo schieramento corrente. Sblocca scenari di organizzazione collettiva." },
  "stance_withdrawn":          { label: "Disimpegnat{o|a}",          cat: "politica", hint: "Lo schieramento corrente. Sblocca scenari del 'mi faccio i cazzi miei'." },
  "lucidita_compliant_diventato":{ label: "Hai visto il sistema",    cat: "politica", hint: "Hai capito di essere diventato 'il tuo capo'. Stance può cambiare." },
  "career_sfida_concorso_cucito":{ label: "Hai sfidato un bando cucito", cat: "politica", hint: "Hai applicato a un concorso scritto per altri. Effetti su barone." },

  // ── Salute (mente / corpo) ──────────────────────────────────────────
  "pers_silenzio_dolore":    { label: "Silenzio doloroso",        cat: "salute",  hint: "Cose subite e mai dette. Pesa sulla stamina. Sblocca scenari di terapia." },
  "pers_in_terapia":         { label: "In psicoterapia",          cat: "salute",  hint: "Bonus stamina passiva. Sblocca scelte di cura quando arrivano." },
  "pers_burnout_clinico":    { label: "Burnout clinico",          cat: "salute",  hint: "Diagnosi formale. Mood permanente 'tired'. Apre ending dedicate." },
  "pers_emicrania_cronica":  { label: "Emicrania cronica",        cat: "salute",  hint: "Cicli neurologici. Costo finanziario (visite private)." },
  "pers_gravidanza_rischio": { label: "Gravidanza a rischio",     cat: "salute",  hint: "Sospensione/INPS. Maternità da 'recuperare' al rientro." },
  "complesso_inferiorita":   { label: "Complesso d'inferiorità",  cat: "salute",  hint: "Scholar refresh compulsivo. Erosione interna." },

  // ── Procedure aperte (concrete, hanno effetti) ──────────────────────
  "cug_segnalazione_aperta":   { label: "Segnalazione CUG aperta",  cat: "procedure", hint: "Pratica formale di molestie / discriminazione. Tempi 3-6 mesi." },
  "burocr_diffida_tar":        { label: "Diffida al TAR depositata",cat: "procedure", hint: "Ricorso giurisdizionale in corso. Sblocca esito udienza." },
  "burocr_sindacato_attivato": { label: "Sindacato attivato",       cat: "procedure", hint: "FLC-CGIL/USB hanno il dossier. Possibile lettera collettiva." },
  "burocr_lettera_collettiva": { label: "Firmata lettera collettiva",cat: "procedure", hint: "Il tuo nome è nella lista pubblica al MUR. Il direttore lo sa." },
  "burocr_avvocato_privato":   { label: "Avvocato del lavoro",      cat: "procedure", hint: "Hai consultato un* avvocat*. Costo: 200-500€ a consulto." },
  "mob_dossier_attivo":        { label: "Dossier mobbing aperto",   cat: "procedure", hint: "Stai documentando demansionamento. Sblocca avvocato → INAIL → perizia." },
  "mob_inail_avviato":         { label: "Pratica INAIL aperta",     cat: "procedure", hint: "Denuncia malattia professionale (costrittività organizzativa)." },
  "mob_strategia_completa":    { label: "Strategia legale completa",cat: "procedure", hint: "Causa civile + INAIL + dimissioni per giusta causa." },
  "fund_causa_ateneo":         { label: "Causa contro l'ateneo",    cat: "procedure", hint: "Vertenza civile in corso. Durata 3-4 anni." },
  "burocr_pec_accesso_atti":   { label: "Accesso atti richiesto",   cat: "procedure", hint: "PEC formale. Silenzio-rifiuto dopo 30 giorni → TAR." },
  "pec_aperta":                { label: "PEC aperta",               cat: "procedure", hint: "Comunicazione formale in attesa di risposta." },
  "vertenza_potenziale":       { label: "Vertenza in valutazione",  cat: "procedure", hint: "Stai pensando di formalizzare. Costi e benefici da soppesare." },
  "gender_documenta_micro_aggressione": { label: "Stai documentando",cat: "procedure", hint: "Screenshot, email, verbali. Materiale per CUG o causa futura." },
  "gender_denuncia_formalizzata":{ label: "Denuncia formalizzata",  cat: "procedure", hint: "Hai aperto la pratica. Punto di non ritorno." },
  "gender_dossier_collettivo":  { label: "Dossier collettivo",      cat: "procedure", hint: "Altre colleghe stanno raccogliendo prove insieme a te." },

  // ── Conseguenze (irreversibili o quasi) ─────────────────────────────
  "career_silent_exit":        { label: "Uscita silenziosa",        cat: "conseguenze", hint: "Hai deciso di non rinnovare. Cerchi altro fuori." },
  "fuggito_estero":            { label: "Sei fuggit{o|a} all'estero",cat: "conseguenze", hint: "Postdoc / RTT in altro paese. Salv{o|a} ma fuori dall'Italia." },
  "dimissionato":              { label: "Dimissioni firmate",       cat: "conseguenze", hint: "Hai chiuso il contratto. Possibile restituzione mensilità." },
  "pers_dimissionato":         { label: "Dimissioni firmate",       cat: "conseguenze", hint: "Hai chiuso il contratto." },
  "pers_uscito_industria":     { label: "Uscito{o|a} in industria", cat: "conseguenze", hint: "Lavori nel privato. Stipendio doppio, ricerca finita." },
  "pers_naspi":                { label: "In NASpI",                 cat: "conseguenze", hint: "18 mesi di disoccupazione indennizzata. Cerchi il prossimo passo." },
  "career_strutturato_ottenuto":{ label: "Strutturat{o|a}!",        cat: "conseguenze", hint: "Hai vinto RTT/associato. Mai più rendiconti — ma a che prezzo?" },
  "career_bocciato_asn":       { label: "ASN bocciata",             cat: "conseguenze", hint: "Devi aspettare 12 mesi. Cool-down obbligatorio." },
  "rinuncia_familiare":        { label: "Rinunce familiari",        cat: "conseguenze", hint: "Figli rimandati, partner lontano. Costi invisibili." },
  "lavoro_in_maternita":       { label: "Lavorato in maternità",    cat: "conseguenze", hint: "Hai fatto attività durante il congedo. Recupero parziale." },

  // ── Famiglia / vita privata ─────────────────────────────────────────
  "pers_partner_lontano":      { label: "Partner lontano",          cat: "famiglia", hint: "Distanza geografica imposta dall'accademia." },
  "pers_paternita_saltata":    { label: "Paternità saltata",        cat: "famiglia", hint: "10 giorni di paternità rinunciati per lavoro." },
  "pers_caregiver":            { label: "Caregiver familiare",      cat: "famiglia", hint: "Assistenza a un* parente. Legge 104 in tasca, costo emotivo alto." },
  "pers_silenzio_famiglia":    { label: "Silenzio in famiglia",     cat: "famiglia", hint: "Hai smesso di raccontare il lavoro a casa." },

  // ── Gender (asimmetria documentata) ─────────────────────────────────
  "gender_silenzio_subito":    { label: "Hai ingoiato (gender)",    cat: "gender", hint: "Auto-censura ricorrente. Accumula: sblocca ending erosione." },
  "gender_no_pubblico":        { label: "Hai detto NO in pubblico", cat: "gender", hint: "Resistenza visibile. Crea costi e alleanze." },
  "gender_rete_protezione":    { label: "Rete di protezione",       cat: "gender", hint: "Colleghe che si avvertono. Riduce isolamento." },
  "gender_corpo_oggetto":      { label: "Corpo come oggetto",       cat: "gender", hint: "Hai sentito sguardi/commenti che pesano. Cumulativo." },
  "gender_etichettata_complicata":{ label: "Etichettata 'complicata'", cat: "gender", hint: "Sei nota per pretendere rispetto. Costa." },
  "gender_pungente_pubblica":  { label: "Risposta pungente in pubblico",cat: "gender", hint: "Hai rotto il decoro. Reputazione doppia: ammirazione + sospetto." },
  "gender_auto_esclusa":       { label: "Auto-esclusione",          cat: "gender", hint: "Hai rinunciato a un concorso/bando per il pattern. Costo invisibile." },
  "gender_vita_ristretta":     { label: "Vita ristretta",           cat: "gender", hint: "Stanze, missioni, eventi che eviti. Strategia di sopravvivenza." },
  "gender_no_punita":          { label: "Il 'no' è stato punito",   cat: "gender", hint: "Ritorsione strutturale dopo un rifiuto. Sblocca cluster legale." },
  "gender_quidproquo_offerto": { label: "Quid pro quo proposto",    cat: "gender", hint: "Ti è stato offerto qualcosa in cambio di disponibilità." },
  "gender_quidproquo_accettato":{ label: "Quid pro quo accettato",  cat: "gender", hint: "Hai detto sì. Sblocca arco 'dottorato che pesa'." },
  "gender_quidproquo_rifiutato":{ label: "Quid pro quo rifiutato",  cat: "gender", hint: "Hai detto no. Sblocca arco 'dottorato che non ho avuto'." },
  "gender_quidproquo_documentato":{ label: "Quid pro quo documentato",cat: "gender", hint: "Hai prove scritte. Materiale per causa." },
  "gender_relazione_direttore":{ label: "Relazione col direttore",  cat: "gender", hint: "Sei in una dinamica asimmetrica. Cambia molti scenari." },
  "gender_dottorato_via_quidproquo":{ label: "Dottorato via QPQ",   cat: "gender", hint: "Sei entrat{a|o} via relazione. Le voci dei corridoi sanno." },

  // ── LGBTQ ───────────────────────────────────────────────────────────
  "lgbtq_padrino_offerto":     { label: "Padrino offerto",          cat: "gender", hint: "Il mentor anziano ti ha proposto protezione." },
  "lgbtq_padrino_accettato":   { label: "Padrino accettato",        cat: "gender", hint: "Sei nella cordata del 'padrino' gay del settore." },
  "lgbtq_padrino_rifiutato":   { label: "Padrino rifiutato",        cat: "gender", hint: "Hai declinato. Aspetta la freddezza istituzionale." },
  "lgbtq_no_pubblico":         { label: "Hai detto NO (lgbtq)",     cat: "gender", hint: "Resistenza visibile in contesto lgbtq accademico." },
  "lgbtq_rete_attivata":       { label: "Rete sotterranea attiva",  cat: "gender", hint: "Sei nella chat dei colleghi LGBTQ del settore. Sapere condiviso." },

  // ── Carriera (pubblicazioni, concorsi) ──────────────────────────────
  "progetto_fantasma":         { label: "Progetto fantasma",        cat: "carriera", hint: "Il PI usa il tuo contratto per altro. Niente PRIN reale." },
  "non_ho_capito_niente":      { label: "Confusione iniziale",      cat: "carriera", hint: "Hai accettato senza capire. Bias di obbedienza nel primo anno." },
  "career_sfruttamento_cronico":{ label: "Sfruttamento cronico",    cat: "carriera", hint: "Carichi a costo zero accumulati. Stanchezza permanente." },
  "career_rassegnato_sistema": { label: "Rassegnat{o|a} al sistema",cat: "carriera", hint: "Hai smesso di alzare la mano. Stamina stabile, dignità in calo." },
  "career_attesa_obbediente":  { label: "Attesa obbediente",        cat: "carriera", hint: "Aspetti la promessa del rinnovo. Senza garanzie." },
  "career_pubblicazione_mdpi": { label: "Pubblicazione MDPI",       cat: "carriera", hint: "Quote ASN con rischio reputazionale." },
  "career_favore_politico":    { label: "Favore politico ottenuto", cat: "carriera", hint: "Hai chiesto qualcosa a chi è nel giro. Debito di gratitudine." },
  "career_attivismo_pubblico": { label: "Attivismo pubblico",       cat: "carriera", hint: "Visibile sulla stampa di settore. Polarizza." },

  // ── Procedure passive / minori ──────────────────────────────────────
  "rendiconto_in_ritardo":     { label: "Rendiconto in ritardo",    cat: "procedure", hint: "Scadenza SIRI mancata. Lettera dall'ufficio in arrivo." },
  "burocr_scadenza_persa":     { label: "Scadenza persa",           cat: "procedure", hint: "Materiale non consegnato in tempo. Possibile sanzione." },
  "passivo":                   { label: "Hai lasciato correre",     cat: "carriera", hint: "Pattern di non-azione. Conseguenze invisibili ma accumulate." },

  // ── Rete e relazioni ────────────────────────────────────────────────
  "pers_ho_aiutato_collega":   { label: "Hai aiutato un* collega",  cat: "rete", hint: "Bonus reputazione peer. Possibile favore di ritorno." },
  "grp_coordinamento_attivo":  { label: "Coordinamento attivo",     cat: "rete", hint: "Ti scrivi con altri precari. Informazione circolante." },
  "grp_lettera_firmata":       { label: "Hai firmato la lettera",   cat: "rete", hint: "Sei pubblicamente parte della rete RTDA." },
  "pers_piano_b_attivo":       { label: "Piano B attivo",           cat: "rete", hint: "Stai cercando alternative concrete (scuola, industria, estero)." },
  "career_cerca_lavoro_attiva":{ label: "Job search attiva",        cat: "rete", hint: "CV aggiornato, LinkedIn acceso. Sblocca recruiter scenarios." },

  // ── Daily / abitudini ───────────────────────────────────────────────
  "daily_confine_difeso":      { label: "Confine difeso",           cat: "salute", hint: "Hai protetto un weekend o una serata. +stamina." },
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
    "Academia Simulator è una satira della carriera accademica italiana, costruita su casi pubblicamente documentati e su osservazione personale dell'ambiente. La storia tocca temi difficili: precariato cronico, burnout, crisi psichiatriche, esiti tragici, molestie e abusi di potere su base sessuale."));
  card.appendChild(el("p", { className: "cw-body" },
    "Giocando come donna il gioco rende esplicito un trattamento differenziale che nella realtà italiana è quotidiano e cumulativo: la maternità rappresentata come difetto da nascondere, commenti sul corpo e sull'abbigliamento, mani sulla spalla, inviti a cena «di lavoro», domande illegali in commissione su «intenzioni familiari», il «cara» davanti ai colleghi e il «collega» nelle email ai maschi, ritorsioni dopo un rifiuto educato, vittimizzazione secondaria nelle denunce. Ogni scena è ancorata a casi pubblici (Sapienza 2018, Bologna 2022, Cagliari 2024, Torino 2024, Pavia/Mojoli 2024-25, Verona/Nocini 2026) o a quello che il chat di chi vive il sistema lascia trapelare."));
  card.appendChild(el("p", { className: "cw-body" },
    "Scegliendo orientamento «LGBTQ» si sblocca un cluster narrativo aggiuntivo: lo stesso quid pro quo (dottorato/contratto/cattedra in cambio di disponibilità) ma con il double-bind specifico dell'outing — denunciare può significare essere out-ed in un dipartimento che non sapeva. È il meccanismo che spiega perché questi casi vengono mediatizzati meno, non perché siano meno frequenti. Ancorato a inchieste UDU/Arcigay, FRA-EU LGBTI Survey 2024, rete Lenford di avvocatura LGBTI+. Il pattern del «mentor-padrino» e della rete sotterranea di solidarietà è documentato in numerose testimonianze raccolte da Arcigay e in casi giudiziari italiani non sempre arrivati alla stampa nazionale."));
  card.appendChild(el("p", { className: "cw-body" },
    "Le scene di molestia e di coercizione sono presentate in modo clinico, mai grafico; servono a nominare un problema reale dell'accademia italiana di cui spesso non si parla. I finali più gravi mostrano sempre risorse di aiuto reali (1522, Differenza Donna, Telefono Amico, Samaritans, CUG d'ateneo, ANAC, Mai più zitte). Non c'è un finale di vittoria — il gioco è una critica del sistema, non un percorso di successo."));
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

// Orientamento — sblocca cluster narrativi specifici (quid pro quo e
// micro-aggressioni hanno meccanismi diversi a seconda dell'orientamento,
// in particolare il double-bind dell'outing per i giocatori LGBTQ).
const ORIENTATIONS = [
  { id: "etero",            name: "Etero",                hint: "Cluster narrativo di default. Quid pro quo classico, commenti sulla maternità, decoro." },
  { id: "lgbtq",            name: "LGBTQ",                hint: "Sblocca scenari sul mentor-padrino, sul double-bind dell'outing, sulla rete di solidarietà queer accademica. Ancorato a inchieste UDU/Arcigay/FRA-EU 2024." },
  { id: "non_specificato",  name: "Non specificat{o|a}", hint: "Sblocca i pattern generali ma non i cluster orientamento-specifici. Scegli questa opzione se preferisci non dichiarare." },
];

function renderStatePicker(root, character, gender, onSelect) {
  root.innerHTML = "";
  const wrap = el("div", { className: "screen screen--select" });
  wrap.appendChild(el("h1", {}, character.name));
  wrap.appendChild(el("p", { className: "tagline" },
    `${gender === "f" ? "Donna" : "Uomo"} · SSD ${character.ssd} · ${character.tagline}`));

  const state = { contractType: character.defaultContractType || "PON",
                  ageBand: character.defaultAgeBand || "33to40",
                  stance: character.defaultStance || "compliant",
                  orientation: character.defaultOrientation || "etero",
                  avatar: {
                    hair: gender === "f" ? "long_f" : "short_m",
                    hairColor: 1,  // castano scuro
                    shirt: 0,      // blu
                    skin: 1,       // chiara/media
                    shirtStyle: "default",
                  } };

  // ---------------- Avatar builder con live preview ----------------
  const avatarCard = el("div", { className: "state-card state-card--avatar" });
  avatarCard.appendChild(el("h3", {}, "Aspetto"));
  avatarCard.appendChild(el("p", { className: "state-card__sub" },
    "Quattro tratti rapidi. L'avatar ti seguirà in tutta la partita — e l'espressione cambierà con lo stress."));

  const avatarPreviewWrap = el("div", { className: "avatar-preview-wrap" });
  const avatarPreview = el("div", { className: "avatar-preview" });
  avatarPreviewWrap.appendChild(avatarPreview);

  function refreshPreview() {
    avatarPreview.innerHTML = "";
    avatarPreview.appendChild(renderAvatar(state.avatar, "neutral", 120));
  }

  // Swatch row helper — clickable color cells
  function makeSwatchRow(palette, currentKey, setterKey, labelText) {
    const row = el("div", { className: "avatar-row" });
    row.appendChild(el("span", { className: "avatar-row__label" }, labelText));
    const swatches = el("div", { className: "avatar-swatches" });
    for (let i = 0; i < palette.length; i++) {
      const cell = el("button", {
        className: `avatar-swatch${state.avatar[setterKey] === i ? " selected" : ""}`,
        style: `background:${palette[i]}`,
        title: palette[i],
        "aria-label": `${labelText} ${i+1}`,
        onClick: () => {
          state.avatar[setterKey] = i;
          refreshAvatarUI();
        },
      });
      swatches.appendChild(cell);
    }
    row.appendChild(swatches);
    return row;
  }

  // Hair style row — text buttons (each style is qualitatively different)
  const hairRow = el("div", { className: "avatar-row" });
  hairRow.appendChild(el("span", { className: "avatar-row__label" }, "Capelli"));
  const hairBtns = el("div", { className: "avatar-hair-row" });
  for (const [key, label] of Object.entries(HAIR_STYLE_LABELS)) {
    const btn = el("button", {
      className: `avatar-hair-btn${state.avatar.hair === key ? " selected" : ""}`,
      onClick: () => { state.avatar.hair = key; refreshAvatarUI(); },
    }, label.split(" — ")[0]);
    hairBtns.appendChild(btn);
  }
  hairRow.appendChild(hairBtns);

  const colorHairRow = makeSwatchRow(HAIR_COLORS, state.avatar.hairColor, "hairColor", "Colore capelli");
  const shirtRow = makeSwatchRow(SHIRT_COLORS, state.avatar.shirt, "shirt", "Maglietta");
  const skinRow = makeSwatchRow(SKIN_TONES, state.avatar.skin, "skin", "Tono pelle");

  const avatarControls = el("div", { className: "avatar-controls" });
  avatarControls.appendChild(hairRow);
  avatarControls.appendChild(colorHairRow);
  avatarControls.appendChild(shirtRow);
  avatarControls.appendChild(skinRow);

  function refreshAvatarUI() {
    // Re-render all swatches (selected state) + preview
    avatarCard.querySelectorAll(".avatar-swatch.selected").forEach(e => e.classList.remove("selected"));
    avatarCard.querySelectorAll(".avatar-hair-btn.selected").forEach(e => e.classList.remove("selected"));
    // Apply selected based on current state — find by index via DOM order
    const swatchGroups = avatarCard.querySelectorAll(".avatar-swatches");
    // swatchGroups order: hairColor, shirt, skin
    const idxs = [state.avatar.hairColor, state.avatar.shirt, state.avatar.skin];
    swatchGroups.forEach((group, gi) => {
      const cells = group.querySelectorAll(".avatar-swatch");
      if (cells[idxs[gi]]) cells[idxs[gi]].classList.add("selected");
    });
    // Hair style buttons
    const hairButtons = avatarCard.querySelectorAll(".avatar-hair-btn");
    const hairKeys = Object.keys(HAIR_STYLE_LABELS);
    hairButtons.forEach((btn, i) => {
      if (hairKeys[i] === state.avatar.hair) btn.classList.add("selected");
    });
    refreshPreview();
  }

  const avatarBody = el("div", { className: "avatar-body" });
  avatarBody.appendChild(avatarPreviewWrap);
  avatarBody.appendChild(avatarControls);
  avatarCard.appendChild(avatarBody);
  refreshPreview();

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

  const orientationCard = el("div", { className: "state-card" });
  orientationCard.appendChild(el("h3", {}, "Orientamento"));
  orientationCard.appendChild(el("p", { className: "state-card__sub" },
    "Sblocca scenari aggiuntivi. Il quid pro quo accademico ha meccanismi diversi a seconda dell'orientamento — in particolare il double-bind dell'outing. Lascia «Etero» se non vuoi esplorare questi cluster."));
  const orientationGroup = el("div", { className: "state-options" });
  function renderOrientations() {
    orientationGroup.innerHTML = "";
    for (const o of ORIENTATIONS) {
      const opt = el("button", {
        className: `state-option${state.orientation === o.id ? " selected" : ""}`,
        onClick: () => { state.orientation = o.id; renderOrientations(); },
      });
      opt.appendChild(el("strong", {}, interpolate(o.name, { character: { gender } })));
      opt.appendChild(el("span", { className: "state-hint" }, o.hint));
      orientationGroup.appendChild(opt);
    }
  }
  renderOrientations();
  orientationCard.appendChild(orientationGroup);

  wrap.appendChild(avatarCard);
  wrap.appendChild(contractCard);
  wrap.appendChild(ageCard);
  wrap.appendChild(stanceCard);
  wrap.appendChild(orientationCard);

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
  const playerMood = derivePlayerMood(state);
  const mbarAvatar = el("div", { className: "mobile-bar__avatar" });
  mbarAvatar.appendChild(renderAvatar(state.character.avatar, playerMood, 32));
  mbar.appendChild(mbarAvatar);
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

  // Left sidebar: avatar + live stats, reputation, inventory
  const sidebar = el("aside", { className: "sidebar" });
  const charSummary = el("div", { className: "char-summary" });
  const sidebarAvatar = el("div", { className: "char-summary__avatar" });
  sidebarAvatar.appendChild(renderAvatar(state.character.avatar, playerMood, 92));
  sidebarAvatar.appendChild(el("span", { className: `mood-tag mood-tag--${playerMood}` },
    interpolate(MOOD_LABEL[playerMood] ?? playerMood, state)));
  charSummary.appendChild(sidebarAvatar);
  charSummary.appendChild(el("h3", {}, state.character.name));
  charSummary.appendChild(el("div", { className: "ssd" }, state.character.ssd));
  charSummary.appendChild(el("div", { className: "char-state" },
    contractLabel(state.character.contractType) + " · " + ageLabel(state.character.ageBand)));
  charSummary.appendChild(el("div", { className: "char-stance" },
    stanceLabel(state.character.stance, state.character.gender)));
  charSummary.appendChild(el("div", { className: "turn-counter" },
    `Mese ${state.turn}  ·  Anno ${Math.ceil(state.turn / 12)}`));
  sidebar.appendChild(charSummary);
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
    const perishBanner = el("div", { className: "perish-banner" });
    // Avatar finale in "crisis" mood — l'immagine del finale
    const finalAvatar = el("div", { className: "perish-banner__avatar" });
    finalAvatar.appendChild(renderAvatar(state.character.avatar, "crisis", 140));
    perishBanner.appendChild(finalAvatar);
    perishBanner.appendChild(el("h2", {}, "Perish."));
    perishBanner.appendChild(el("div", { className: "perish-cause" },
      interpolate(state.ending.perishCause, state)));
    perishBanner.appendChild(el("button", {
      className: "btn", onClick: handlers.onRestart,
    }, "Nuova carriera"));
    main.appendChild(perishBanner);
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

  // Active tags — solo i flag mappati in FLAG_DISPLAY (rilevanti al gameplay),
  // raggruppati per categoria, con label leggibile e tooltip esplicativo.
  const milestoneFlagSet = new Set(state.milestones.map((m) => m.flag));
  const relevantFlags = state.flags
    .filter((f) => !milestoneFlagSet.has(f))
    .filter((f) => FLAG_DISPLAY[f]);
  if (relevantFlags.length > 0) {
    const byCat = {};
    for (const f of relevantFlags) {
      const meta = FLAG_DISPLAY[f];
      (byCat[meta.cat] ??= []).push({ flag: f, meta });
    }
    dossier.appendChild(el("h4", {}, "Cosa pesa adesso"));
    const tagsWrap = el("div", { className: "flag-tags" });
    // Ordine categorie: dalle più "concrete/azione" alle più "tratto"
    const catOrder = [
      ["procedure",   "Procedure aperte"],
      ["conseguenze", "Conseguenze"],
      ["salute",      "Salute"],
      ["gender",      "Asimmetrie di genere"],
      ["politica",    "Posizione politica"],
      ["carriera",    "Carriera"],
      ["famiglia",    "Vita privata"],
      ["rete",        "Rete & alleanze"],
      ["tratto",      "Tratti"],
    ];
    for (const [catId, catLabel] of catOrder) {
      const entries = byCat[catId];
      if (!entries?.length) continue;
      const section = el("div", { className: "flag-cat" });
      section.appendChild(el("div", { className: "flag-cat-label" }, catLabel));
      const row = el("div", { className: "flag-cat-row" });
      for (const { flag, meta } of entries) {
        const label = interpolate(meta.label, state);
        const hint = interpolate(meta.hint, state);
        row.appendChild(el("span", {
          className: `flag-tag flag-tag--${catId}`,
          title: hint,
          "data-flag": flag,
        }, label));
      }
      section.appendChild(row);
      tagsWrap.appendChild(section);
    }
    dossier.appendChild(tagsWrap);
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
    const article = el("article", { className: "feed-entry feed-entry--scenario" });
    const header = el("header", {},
      el("span", { className: "month" }, `M${entry.turn}`),
      el("h3", {}, entry.title));
    const badge = renderAnchorBadge("scenarios", entry.id);
    if (badge) header.appendChild(badge);
    article.appendChild(header);
    article.appendChild(el("p", {}, entry.text));
    return article;
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
    const article = el("article", { className: "feed-entry feed-entry--event" });
    const header = el("header", {},
      el("span", { className: "month" }, `M${entry.turn}`),
      el("h4", {}, `Evento: ${entry.title}`));
    const badge = renderAnchorBadge("events", entry.id);
    if (badge) header.appendChild(badge);
    article.appendChild(header);
    article.appendChild(el("p", {}, entry.text));
    return article;
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
    // Avatar NPC: deduco il mood dalla delta di reputazione associata
    // (positiva → happy, negativa → stressed). Se non c'è, neutral.
    const npcMoodForEntry = reactionMood(entry.from, entry.repDelta);
    const npcAvatar = renderNpcAvatar(entry.from, npcMoodForEntry, 44);
    const article = el("article", { className: "feed-entry feed-entry--reaction" });
    const header = el("header", {},
      el("span", { className: "month" }, `M${entry.turn}`),
      el("span", { className: "reaction-from" }, from));
    article.appendChild(header);
    const body = el("div", { className: "reaction-body" });
    if (npcAvatar) {
      const avatarSlot = el("div", { className: "reaction-avatar" }, npcAvatar);
      body.appendChild(avatarSlot);
    }
    body.appendChild(el("p", {}, entry.text));
    article.appendChild(body);
    return article;
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
    const wrap = el("article", { className: "feed-entry feed-entry--ending" });
    const header = el("header", {},
      el("h2", {}, entry.title),
      el("div", { className: "perish-cause" }, entry.cause));
    const badge = renderAnchorBadge("endings", entry.id);
    if (badge) header.appendChild(badge);
    wrap.appendChild(header);
    wrap.appendChild(el("p", {}, entry.text));

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
