// Entry point: load data, wire UI, manage screen transitions.
//
// All imports go through a `?v=...` query string so a single version bump in
// index.html (on the main.js URL) invalidates the entire module graph in the
// browser. Without this, the browser memoizes ES modules for the lifetime of
// the page and stale code persists across reloads.

const META_URL = new URL(import.meta.url);
const VERSION_PARAM = META_URL.searchParams.get("v");
const QS = VERSION_PARAM ? `?v=${VERSION_PARAM}` : "";

const { loadGameData } = await import(`./data.js${QS}`);
const { createGameState, startGame, applyChoice, applyEventChoice, useItem,
        setStorageAdapter, saveState, loadState, clearSave } =
  await import(`./engine.js${QS}`);
const { browserSessionStorage } = await import(`./storage.js${QS}`);
setStorageAdapter(browserSessionStorage());
const { renderCharacterSelect, renderGame, renderContentWarning } =
  await import(`./ui.js${QS}`);

const CW_KEY = "academiasim.cw_acknowledged.v1";

const root = document.getElementById("app");
let DATA = null;
let state = null;

async function boot() {
  try {
    DATA = await loadGameData();
  } catch (err) {
    root.innerHTML = `<div class="screen screen--error"><h1>Errore di caricamento</h1>
      <p>${err.message}</p>
      <p class="hint">Apri la console (F12) per i dettagli. Se stai aprendo il file direttamente,
      avvia un server locale: <code>python3 scripts/dev_server.py</code> e poi <code>http://localhost:8765</code>.</p></div>`;
    return;
  }
  showInitialScreen();
}

function showInitialScreen() {
  let acknowledged = false;
  try { acknowledged = localStorage.getItem(CW_KEY) === "1"; } catch (_) {}
  if (!acknowledged) {
    renderContentWarning(root, () => {
      try { localStorage.setItem(CW_KEY, "1"); } catch (_) {}
      decideNextScreen();
    });
    return;
  }
  decideNextScreen();
}

function decideNextScreen() {
  // Resume from a saved game-in-progress, if one exists. This keeps the
  // player's session alive across accidental refreshes. A run is "in progress"
  // when there's a character set; perished saves return to character select.
  const saved = loadState();
  if (saved && saved.character && !saved.perished) {
    state = saved;
    render();
    return;
  }
  showCharacterSelect();
}

function showCharacterSelect() {
  clearSave();
  state = null;
  renderCharacterSelect(root, DATA.characters, onCharacterChosen);
}

function onCharacterChosen(character, gender) {
  state = createGameState(character, gender);
  startGame(state, DATA);
  saveState(state);
  render();
}

function onChoice(choice) {
  applyChoice(state, DATA, choice);
  saveState(state);
  render();
}

function onEventChoice(choice) {
  applyEventChoice(state, DATA, choice);
  saveState(state);
  render();
}

function onUseItem(itemId) {
  useItem(state, DATA, itemId);
  saveState(state);
  render();
}

function render() {
  renderGame(root, state, DATA.factions, DATA.items,
    { onChoice, onEventChoice, onUseItem, onRestart: showCharacterSelect });
}

boot();
