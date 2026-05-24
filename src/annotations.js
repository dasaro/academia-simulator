// Annotations loader. Carica `data/annotations.json` se presente.
//
// In produzione (GitHub Pages) il file è gitignored e non esiste — il fetch
// fallisce silenziosamente, niente annotazioni mostrate. In locale (dove il
// file è presente) le annotazioni vengono caricate e l'UI mostra un piccolo
// badge ℹ accanto al titolo di ogni scenario / event / ending che ha
// un'ancora associata.

const META_URL = new URL(import.meta.url);
const VERSION_PARAM = META_URL.searchParams.get("v");
const QS = VERSION_PARAM ? `?v=${VERSION_PARAM}` : "";

let _annotations = null;
let _loaded = false;

export async function loadAnnotations() {
  if (_loaded) return _annotations;
  _loaded = true;
  try {
    const res = await fetch(`./data/annotations.json${QS}`, { cache: "no-cache" });
    if (!res.ok) {
      _annotations = null;
      return null;
    }
    _annotations = await res.json();
    return _annotations;
  } catch (e) {
    // Nessun file → produzione → nessuna annotazione. Comportamento atteso.
    _annotations = null;
    return null;
  }
}

export function getAnnotation(kind, id) {
  if (!_annotations) return null;
  const bucket = _annotations[kind];
  if (!bucket) return null;
  return bucket[id] ?? null;
}

export function hasAnnotations() {
  return _annotations !== null;
}
