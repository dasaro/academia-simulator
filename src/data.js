// Loads all game data JSON files. Browser-side, no build step.

const DATA_FILES = {
  characters: "data/game/characters.json",
  scenarios: "data/game/scenarios.json",
  events: "data/game/randomEvents.json",
  endings: "data/game/endings.json",
  factions: "data/game/factions.json",
  items: "data/game/items.json",
};

// Cache-busting query string lifted from main.js's `?v=` parameter. Browsers
// memoize fetch responses for the page lifetime and some ignore no-store
// headers; forcing a unique URL per version reliably gets fresh data.
const META_URL = new URL(import.meta.url);
const VERSION_PARAM = META_URL.searchParams.get("v");
const QS = VERSION_PARAM ? `?v=${VERSION_PARAM}` : "";

export async function loadGameData() {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, path]) => {
      const res = await fetch(`${path}${QS}`, { cache: "reload" });
      if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
      const json = await res.json();
      // Each file has a single top-level array under a known key.
      const arrayKey = Object.keys(json).find((k) => Array.isArray(json[k]));
      return [key, arrayKey ? json[arrayKey] : json];
    })
  );
  return Object.fromEntries(entries);
}
