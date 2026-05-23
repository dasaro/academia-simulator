// Storage adapter — tiny abstraction so the engine doesn't import a browser
// global directly. The web build wires `browserSessionStorage`; a React Native
// build would pass an AsyncStorage-backed adapter; a Node test harness can pass
// a Map-backed one.
//
// Contract:
//   load(key) → object | null
//   save(key, value) → void (value is JSON-serializable)
//   clear(key) → void

export function browserSessionStorage() {
  return {
    load(key) {
      try {
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    },
    save(key, value) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    },
    clear(key) {
      try { sessionStorage.removeItem(key); } catch (_) {}
    },
  };
}

// In-memory adapter — useful for Node-side smoke tests and as the default
// fallback when no other adapter is wired.
export function memoryStorage() {
  const map = new Map();
  return {
    load(key) { return map.has(key) ? structuredClone(map.get(key)) : null; },
    save(key, value) { map.set(key, structuredClone(value)); },
    clear(key) { map.delete(key); },
  };
}

// Default no-op (used if the engine is initialized without an adapter — e.g.,
// when the caller doesn't care about persistence).
export function nullStorage() {
  return { load() { return null; }, save() {}, clear() {} };
}
