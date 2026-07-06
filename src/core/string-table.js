const KEY_RE = /^\s*"Key"\s*:\s*"([^"]+)"/;

let _index = null;
let _loaded = false;

export function buildStringIndex(files) {
  _index = new Map();
  for (const { path, text } of files) {
    if (!text) continue;
    let entryIndex = 0;
    for (const line of text.split("\n")) {
      const m = KEY_RE.exec(line);
      if (m) {
        const key = m[1].toLowerCase();
        if (!_index.has(key)) _index.set(key, { filePath: path, entryIndex });
        entryIndex++;
      }
    }
  }
  _loaded = true;
}

export function findStringKey(key) {
  if (!_loaded) return null;
  return _index?.get((key ?? "").toLowerCase()) ?? null;
}

export function clearStringIndex() {
  _index = null;
  _loaded = false;
}

export function isStringIndexLoaded() {
  return _loaded;
}
