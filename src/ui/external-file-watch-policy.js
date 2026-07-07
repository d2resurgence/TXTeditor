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
    notifiedMs: modifiedMs
  });
}

export function acknowledgeExternalChange(doc, modifiedMs) {
  if (!canReloadDocument(doc) || modifiedMs == null) return;
  diskWatchStates.set(doc, {
    baselineMs: modifiedMs,
    notifiedMs: modifiedMs
  });
}

export function clearDiskWatchState(doc) {
  diskWatchStates.delete(doc);
}
