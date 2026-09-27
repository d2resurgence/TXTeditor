import { canReloadDocument } from "./document-reload-policy.js";

const diskWatchStates = new WeakMap();

export function externalChangeMessage(doc) {
  return `${doc.name} changed on disk.`;
}

export function isExternalFileChange(baselineMs, currentMs) {
  if (baselineMs == null || currentMs == null) return false;
  return currentMs > baselineMs;
}

export function shouldNotifyExternalChange(doc, currentMs) {
  if (!canReloadDocument(doc)) return false;
  const state = diskWatchStates.get(doc);
  if (!state) return false;
  if (!isExternalFileChange(state.baselineMs, currentMs)) return false;
  return currentMs > state.notifiedMs;
}

export function setDiskWatchBaseline(doc, modifiedMs) {
  if (!canReloadDocument(doc) || modifiedMs == null) {
    diskWatchStates.delete(doc);
    return;
  }
  diskWatchStates.set(doc, {
    baselineMs: modifiedMs,
    notifiedMs: modifiedMs,
    // The disk version the editor's content is based on (last open, reload or save).
    syncedMs: modifiedMs
  });
}

// Dismissing the banner silences it, but the editor still holds the older content,
// so syncedMs is left alone and a later save still warns.
export function acknowledgeExternalChange(doc, modifiedMs) {
  if (!canReloadDocument(doc) || modifiedMs == null) return;
  const previous = diskWatchStates.get(doc);
  diskWatchStates.set(doc, {
    baselineMs: modifiedMs,
    notifiedMs: modifiedMs,
    syncedMs: previous?.syncedMs ?? modifiedMs
  });
}

export function isSaveOverExternalChange(doc, currentMs) {
  if (!canReloadDocument(doc) || currentMs == null) return false;
  const state = diskWatchStates.get(doc);
  if (!state || state.syncedMs == null) return false;
  return currentMs > state.syncedMs;
}

export function saveConflictMessage(doc) {
  return `${doc.name} changed on disk since it was opened. Saving will overwrite those changes.`;
}

export function clearDiskWatchState(doc) {
  diskWatchStates.delete(doc);
}
