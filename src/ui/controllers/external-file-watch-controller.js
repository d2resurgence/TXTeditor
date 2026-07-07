import { isTauriRuntime, readFileModifiedTimes } from "../../core/io.js";
import {
  acknowledgeExternalChange,
  clearDiskWatchState,
  externalChangeMessage,
  setDiskWatchBaseline,
  shouldNotifyExternalChange
} from "../external-file-watch-policy.js";

const POLL_INTERVAL_MS = 2000;

export function createExternalFileWatchController({
  state,
  els,
  reloadDocumentAtIndex,
  isDocumentSavePending = () => false
}) {
  let pollTimer = null;
  let pendingChange = null;

  function documentIndex(doc) {
    return state.docs.indexOf(doc);
  }

  function hideBanner() {
    pendingChange = null;
    els.externalChangeBanner?.classList.add("hidden");
  }

  function showBanner(doc, modifiedMs) {
    pendingChange = { doc, modifiedMs };
    if (els.externalChangeMessage) {
      els.externalChangeMessage.textContent = externalChangeMessage(doc);
    }
    els.externalChangeBanner?.classList.remove("hidden");
  }

  async function syncDocumentBaseline(doc) {
    if (!isTauriRuntime() || !doc?.path) return;
    const [result] = await readFileModifiedTimes([doc.path]);
    if (result?.modified_ms != null) setDiskWatchBaseline(doc, result.modified_ms);
  }

  async function syncAllOpenDocuments() {
    await Promise.all(state.docs.map((doc) => syncDocumentBaseline(doc)));
  }

  async function pollExternalChanges() {
    if (!isTauriRuntime() || document.hidden || pendingChange) return;
    const watched = state.docs.filter((doc) => doc.path && !isDocumentSavePending(doc));
    if (!watched.length) return;
    const paths = watched.map((doc) => doc.path);
    const results = await readFileModifiedTimes(paths);
    const modifiedByPath = new Map(results.map((result) => [result.path, result.modified_ms]));
    for (const doc of watched) {
      const modifiedMs = modifiedByPath.get(doc.path);
      if (!shouldNotifyExternalChange(doc, modifiedMs)) continue;
      showBanner(doc, modifiedMs);
      return;
    }
  }

  async function reloadPendingChange() {
    if (!pendingChange) return;
    const { doc, modifiedMs } = pendingChange;
    hideBanner();
    const index = documentIndex(doc);
    if (index < 0) return;
    const reloaded = await reloadDocumentAtIndex(index);
    if (reloaded) {
      await syncDocumentBaseline(state.docs[index]);
      return;
    }
    if (documentIndex(doc) >= 0 && shouldNotifyExternalChange(doc, modifiedMs)) {
      showBanner(doc, modifiedMs);
    }
  }

  function dismissPendingChange() {
    if (!pendingChange) return;
    acknowledgeExternalChange(pendingChange.doc, pendingChange.modifiedMs);
    hideBanner();
    pollExternalChanges().catch(() => {});
  }

  function wireEvents() {
    els.externalChangeReload?.addEventListener("click", () => {
      reloadPendingChange().catch(() => {});
    });
    els.externalChangeDismiss?.addEventListener("click", dismissPendingChange);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) pollExternalChanges().catch(() => {});
    });
  }

  function start() {
    if (!isTauriRuntime() || pollTimer) return;
    wireEvents();
    syncAllOpenDocuments().catch(() => {});
    pollTimer = setInterval(() => {
      pollExternalChanges().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    hideBanner();
  }

  function forgetDocument(doc) {
    if (pendingChange?.doc === doc) hideBanner();
    clearDiskWatchState(doc);
  }

  function resolveReloadedDocument(doc) {
    if (!pendingChange?.doc?.path || !doc?.path) return;
    if (pendingChange.doc.path !== doc.path) return;
    hideBanner();
  }

  return {
    forgetDocument,
    hideBanner,
    resolveReloadedDocument,
    start,
    stop,
    syncDocumentBaseline
  };
}
