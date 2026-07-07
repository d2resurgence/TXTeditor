import { configuredAutofitColumnIndexes } from "../../core/autofit-columns-policy.js";
import { TableDocument } from "../../core/table-model.js";
import { LARGE_FILE_THRESHOLDS } from "../../core/large-file-policy.js";
import { markTableSaved, tableFileState } from "../../core/table-file-state.js";
import { isTextLikeFile, isTextLikePath } from "../../core/text-file-policy.js";
import {
  closeWindow,
  downloadText,
  isTauriRuntime,
  openFilesNative,
  openNativePaths,
  openNativePathsBulk,
  openWorkspaceFromPath,
  openWorkspaceNative,
  readFileAsDocument,
  readRawTextFiles,
  saveConfig,
  saveDocumentNative
} from "../../core/io.js";
import { isJsonStringView, tableDocumentFromJsonStrings } from "../../core/string-goto-policy.js";
import {
  LINT_ENGINE_VECTOR,
  documentOpenSyncRoute,
  legacyLintImmediateSchedule
} from "../../core/lint-controller-policy.js";
import {
  activeIndexAfterTabClose,
  closeDialogMessage,
  documentOpenPlan,
  unsavedDocuments
} from "../document-lifecycle-policy.js";
import {
  applyDocumentViewState,
  canReloadDocument,
  reloadDialogMessage,
  snapshotDocumentViewState
} from "../document-reload-policy.js";

export function createDocumentController({
  state,
  els,
  grid,
  emptyDoc,
  activeDoc,
  saveSelectionState,
  applyFreezeToDoc,
  renderChrome,
  showError,
  showToast,
  reportWindowCloseFailure,
  lspOpenDoc,
  reportLspOpenFailure,
  lspCloseDoc,
  reportLspCloseFailure,
  lspStartWorkspace,
  scheduleHoverPrewarm,
  resetUndoManagerForDocument,
  resetLegacyWorkspaceIndex,
  scheduleLegacyLintForOpen,
  scheduleLegacyLintFull,
  cancelLegacyLintJobs,
  isVectorLintEngine,
  isLegacyLintEngine,
  updateGridDiagnostics,
  scrollProblemsToActiveFile,
  loadStringTablesForWorkspace = async () => {},
  saveJsonStringViewIfNeeded = async () => false
}) {
  let pendingCloseResolve = null;
  const pendingSaves = new WeakMap();

  function hasOpenDocument() {
    return state.docs.length > 0 && state.active >= 0;
  }

  async function wireCloseHandler() {
    if (!isTauriRuntime()) return;
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    await tauri.event.listen("app-close-requested", async () => {
      commitActiveEdit();
      const unsaved = unsavedDocuments(state.docs);
      if (!unsaved.length) {
        closeWindow().catch((error) => reportWindowCloseFailure(error, "app-close-requested"));
        return;
      }
      for (const doc of [...unsaved]) {
        const index = state.docs.indexOf(doc);
        if (index >= 0) {
          state.active = index;
          applyFreezeToDoc(activeDoc());
          grid.setDocument(activeDoc());
          renderChrome();
        }
        const choice = await askCloseChoice(doc);
        if (choice === "cancel") return;
        if (choice === "save") {
          const saved = await saveFile().catch(() => false);
          if (!saved || doc.dirty) return;
        }
      }
      closeWindow().catch((error) => reportWindowCloseFailure(error, "app-close-requested"));
    });
  }

  function handleCloseDialogClick(event) {
    const choice = event.target.closest("[data-close-choice]")?.dataset.closeChoice;
    if (choice && pendingCloseResolve) {
      pendingCloseResolve(choice);
      pendingCloseResolve = null;
      els.closeDialog.classList.add("hidden");
    }
  }

  async function applyConfiguredAutofit(doc) {
    const columns = configuredAutofitColumnIndexes(doc, state.config?.autofitColumns ?? {});
    if (!columns.length || typeof grid.measureColumnFitWidth !== "function") return;
    const wasDirty = doc.dirty;
    const widths = await Promise.all(columns.map((column) => grid.measureColumnFitWidth(column, { yieldEvery: 0 })));
    columns.forEach((column, index) => doc.setColumnWidth(column, widths[index]));
    doc.dirty = wasDirty;
  }

  async function applyWorkspace(workspace) {
    state.workspace = workspace;
    resetLegacyWorkspaceIndex();
    state.config = { ...(state.config ?? {}), lastWorkspacePath: workspace.path };
    saveConfig(state.config).catch(() => {});
    loadStringTablesForWorkspace(workspace.path).catch(() => {});
    if (isVectorLintEngine()) {
      await lspStartWorkspace(workspace.path).catch(showError);
    } else {
      const schedule = legacyLintImmediateSchedule("workspace-opened");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    }
    renderChrome();
  }

  async function restoreLastWorkspace() {
    if (!isTauriRuntime()) return false;
    const { restoreWorkspace, lastWorkspacePath } = state.config ?? {};
    if (!restoreWorkspace || !lastWorkspacePath) return false;
    try {
      const workspace = await openWorkspaceFromPath(lastWorkspacePath);
      if (!workspace) return false;
      await applyWorkspace(workspace);
      return true;
    } catch {
      return false;
    }
  }

  function activateDocument(doc) {
    if (!doc) return;
    const index = state.docs.indexOf(doc);
    if (index < 0) return;
    if (index !== state.active) {
      saveSelectionState();
      state.active = index;
    }
    applyFreezeToDoc(activeDoc());
    if (grid.doc !== activeDoc()) grid.setDocument(activeDoc());
    renderChrome();
  }

  function cloneSelectionSnapshot(snapshot) {
    if (!snapshot) return null;
    return {
      anchor: { ...snapshot.anchor },
      focus: { ...snapshot.focus },
      ranges: snapshot.ranges.map((range) => ({
        top: range.top,
        left: range.left,
        bottom: range.bottom,
        right: range.right
      }))
    };
  }

  function stageDocumentView(doc, snapshot, focusRow, focusColumn) {
    if (!doc || !snapshot) return;
    const column = Math.max(0, focusColumn ?? 0);
    const selectionSnapshot = cloneSelectionSnapshot({
      ...snapshot,
      focus: { row: focusRow, column }
    });
    doc.selectionState = selectionSnapshot;

    if (grid.doc === doc) {
      state.selection.restore(selectionSnapshot, doc.rowCount, doc.columnCount);
      grid.layout();
      grid.scrollCellIntoView(focusRow, column);
      doc.scrollLeft = grid.scrollLeft;
      doc.scrollTop = grid.scrollTop;
      doc.selectionState = cloneSelectionSnapshot(state.selection.snapshot());
      return;
    }

    const activeIndex = state.active;
    const activeDocRef = state.docs[activeIndex];
    if (!activeDocRef) return;

    const activeSnapshot = cloneSelectionSnapshot(state.selection.snapshot());
    const scrollLeft = grid.scrollLeft;
    const scrollTop = grid.scrollTop;

    grid.setDocument(doc);
    state.selection.restore(selectionSnapshot, doc.rowCount, doc.columnCount);
    grid.layout();
    grid.scrollCellIntoView(focusRow, column);
    doc.scrollLeft = grid.scrollLeft;
    doc.scrollTop = grid.scrollTop;
    doc.selectionState = cloneSelectionSnapshot(state.selection.snapshot());

    state.active = activeIndex;
    applyFreezeToDoc(activeDocRef);
    grid.setDocument(activeDocRef);
    if (activeSnapshot) {
      state.selection.restore(activeSnapshot, activeDocRef.rowCount, activeDocRef.columnCount);
    }
    grid.host.scrollLeft = scrollLeft;
    grid.host.scrollTop = scrollTop;
    activeDocRef.scrollLeft = scrollLeft;
    activeDocRef.scrollTop = scrollTop;
    activeDocRef.selectionState = cloneSelectionSnapshot(state.selection.snapshot());
  }

  async function addDocument(doc) {
    const plan = documentOpenPlan(state.docs, doc);
    if (plan.action === "activate-existing") {
      saveSelectionState();
      state.active = plan.activeIndex;
      grid.setDocument(activeDoc());
      renderChrome();
      return;
    }
    resetUndoManagerForDocument(doc);
    doc.zoom = 1;
    state.docs.push(doc);
    saveSelectionState();
    state.active = plan.activeIndex;
    applyFreezeToDoc(doc);
    grid.setDocument(doc);
    if (doc.largeFileMode) {
      doc.initialColumnFitApplied = true;
      state.lint.status = `Large file mode: lint paused for ${doc.name}.`;
    } else {
      if (isOpenStatus(state.lint.status)) state.lint.status = "";
    }
    if (!doc.largeFileMode && !doc.initialColumnFitApplied) {
      grid.autoFitInitialColumns();
      await applyConfiguredAutofit(doc);
      doc.initialColumnFitApplied = true;
      grid.layout();
    }
    renderChrome();
    scrollProblemsToActiveFile();
    if (doc.largeFileMode) return;
    if (documentOpenSyncRoute(state.lint.engine) === "vector-open") {
      lspOpenDoc(doc).catch((error) => reportLspOpenFailure(doc, error, "document-open"));
      scheduleHoverPrewarm("document-opened");
    } else {
      scheduleLegacyLintForOpen("file-opened");
    }
  }

  async function openFile() {
    try {
      if (isTauriRuntime()) {
        await showOpeningFeedback("Opening file...");
        const docs = await openFilesNative(TableDocument);
        for (const doc of docs) await addDocument(doc);
      } else if ("showOpenFilePicker" in window) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Structured text", accept: { "text/plain": [".txt", ".tsv", ".tbl", ".csv"] } }]
        });
        for (const handle of handles) {
          const file = await handle.getFile();
          if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(`Opening large file: ${file.name}...`);
          const doc = await readFileAsDocument(file, TableDocument);
          doc.handle = handle;
          await addDocument(doc);
        }
      } else {
        els.fileInput.click();
      }
    } catch (error) {
      showError(error);
    }
  }

  async function openDroppedNativePaths(paths) {
    try {
      const textPaths = paths.filter(isTextLikePath);
      if (textPaths.length) await showOpeningFeedback(`Opening ${textPaths.length} file(s)...`);
      const docs = await openNativePaths(textPaths, TableDocument);
      for (const doc of docs) await addDocument(doc);
    } catch (error) {
      showError(error);
    }
  }

  async function openBrowserFiles(files) {
    const textFiles = Array.from(files ?? []).filter(isTextLikeFile);
    for (const file of textFiles) {
      if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(`Opening large file: ${file.name}...`);
      await addDocument(await readFileAsDocument(file, TableDocument));
    }
  }

  async function openFolder() {
    try {
      if (!isTauriRuntime()) {
        showError("Open Folder is available in the desktop app.");
        return;
      }
      const workspace = await openWorkspaceNative();
      if (!workspace) return;
      await applyWorkspace(workspace);
    } catch (error) {
      showError(error);
    }
  }

  async function saveFile() {
    try {
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      commitActiveEdit();
      const doc = activeDoc();
      if (!isTauriRuntime() && !doc.handle?.createWritable) return saveAs();
      return await queueSave(doc, () => saveFileNow(doc));
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function saveFileNow(doc) {
    if (isTauriRuntime()) {
      if (await saveJsonStringViewIfNeeded(doc)) {
        grid.draw();
        renderChrome();
        return true;
      }
      const saved = await saveDocumentNative(doc, false);
      if (!saved) return false;
      grid.draw();
      renderChrome();
      return true;
    }
    const revision = tableFileState(doc).revision;
    const writable = await doc.handle.createWritable();
    await writeDocumentText(writable, doc);
    await writable.close();
    markTableSaved(doc, revision);
    renderChrome();
    return true;
  }

  async function saveAll() {
    if (!hasOpenDocument()) return;
    commitActiveEdit();
    const previous = state.active;
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < state.docs.length; i++) {
      if (!state.docs[i].dirty) continue;
      state.active = i;
      applyFreezeToDoc(activeDoc());
      grid.setDocument(activeDoc());
      const ok = await saveFile().catch(() => false);
      if (ok) saved++;
      else failed++;
    }
    state.active = previous;
    applyFreezeToDoc(activeDoc());
    grid.setDocument(activeDoc());
    grid.draw();
    renderChrome();
    if (failed > 0) showError(`${failed} file(s) could not be saved.`);
    else if (saved > 0) showToast(`Saved ${saved} file(s).`);
  }

  async function saveAs() {
    try {
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      commitActiveEdit();
      const doc = activeDoc();
      return await queueSave(doc, () => saveAsNow(doc));
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function saveAsNow(doc) {
    if (isTauriRuntime()) {
      const saved = await saveDocumentNative(doc, true);
      if (!saved) return false;
      grid.draw();
      renderChrome();
      return true;
    } else if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
      const revision = tableFileState(doc).revision;
      const writable = await handle.createWritable();
      await writeDocumentText(writable, doc);
      await writable.close();
      doc.handle = handle;
      doc.name = handle.name ?? doc.name;
      markTableSaved(doc, revision);
      renderChrome();
      return true;
    } else {
      const revision = tableFileState(doc).revision;
      const text = doc.toText();
      downloadText(doc.name, text);
      markTableSaved(doc, revision);
      renderChrome();
      return true;
    }
  }

  async function loadFixture(size) {
    const name = size === 200000 ? "d2_200k.tsv" : "d2_20k.tsv";
    const response = await fetch(`./fixtures/${name}`);
    const text = await response.text();
    await addDocument(TableDocument.fromText(name, text));
  }

  async function closeTab(index) {
    if (index < 0 || index >= state.docs.length) return;
    commitActiveEdit();
    const doc = state.docs[index];
    if (doc.dirty) {
      const choice = await askCloseChoice(doc);
      if (choice === "cancel") return;
      if (choice === "save") {
        const previous = state.active;
        state.active = index;
        grid.setDocument(activeDoc());
        const saved = await saveFile();
        state.active = previous;
        if (!saved || doc.dirty) {
          grid.setDocument(activeDoc());
          renderChrome();
          return;
        }
      }
    }
    if (isVectorLintEngine()) lspCloseDoc(doc).catch((error) => reportLspCloseFailure(doc, error, "tab-close"));
    else cancelLegacyLintJobs({ clearDiagnostics: false });
    const documentCountBeforeClose = state.docs.length;
    state.docs.splice(index, 1);
    if (!state.docs.length) {
      state.active = -1;
      grid.setDocument(emptyDoc);
    } else {
      state.active = activeIndexAfterTabClose({
        activeIndex: state.active,
        closeIndex: index,
        documentCount: documentCountBeforeClose
      });
      grid.setDocument(activeDoc());
    }
    if (isLegacyLintEngine()) scheduleLegacyLintFull("tab-closed", 0);
    updateGridDiagnostics();
    renderChrome();
  }

  function askCloseChoice(doc) {
    return askDiscardChoice(doc, closeDialogMessage(doc));
  }

  function askReloadChoice(doc) {
    return askDiscardChoice(doc, reloadDialogMessage(doc));
  }

  function askDiscardChoice(doc, message) {
    els.closeDialogText.textContent = message;
    els.closeDialog.classList.remove("hidden");
    return new Promise((resolve) => {
      pendingCloseResolve = resolve;
    });
  }

  async function readDocumentFromDisk(oldDoc) {
    if (isJsonStringView(oldDoc)) {
      const [result] = await readRawTextFiles([oldDoc.path]);
      if (!result?.text) throw new Error(`Could not reload ${oldDoc.name}.`);
      return tableDocumentFromJsonStrings(oldDoc.name, oldDoc.path, result.text);
    }
    if (isTauriRuntime()) {
      const [result] = await openNativePathsBulk([oldDoc.path], TableDocument);
      if (result?.error) throw new Error(result.error);
      if (!result?.doc) throw new Error(`Could not reload ${oldDoc.name}.`);
      return result.doc;
    }
    if (oldDoc.handle?.getFile) {
      const file = await oldDoc.handle.getFile();
      const doc = await readFileAsDocument(file, TableDocument);
      doc.handle = oldDoc.handle;
      return doc;
    }
    throw new Error(`Save ${oldDoc.name} before reloading.`);
  }

  async function reloadDocumentAtIndex(index, { quiet = false } = {}) {
    if (index < 0 || index >= state.docs.length) return false;
    const oldDoc = state.docs[index];
    if (!canReloadDocument(oldDoc)) {
      if (!quiet) showError(`Save ${oldDoc.name} before reloading.`);
      return false;
    }
    if (oldDoc.dirty) {
      const previous = state.active;
      if (index !== previous) {
        state.active = index;
        applyFreezeToDoc(activeDoc());
        grid.setDocument(activeDoc());
        renderChrome();
      }
      const choice = await askReloadChoice(oldDoc);
      if (choice === "cancel") {
        if (index !== previous) {
          state.active = previous;
          applyFreezeToDoc(activeDoc());
          grid.setDocument(activeDoc());
          renderChrome();
        }
        return false;
      }
      if (choice === "save") {
        const saved = await saveFile();
        if (index !== previous) {
          state.active = previous;
          applyFreezeToDoc(activeDoc());
          grid.setDocument(activeDoc());
          renderChrome();
        }
        if (!saved || oldDoc.dirty) return false;
      } else if (choice !== "discard") {
        if (index !== previous) {
          state.active = previous;
          applyFreezeToDoc(activeDoc());
          grid.setDocument(activeDoc());
          renderChrome();
        }
        return false;
      } else if (index !== previous) {
        state.active = previous;
        applyFreezeToDoc(activeDoc());
        grid.setDocument(activeDoc());
        renderChrome();
      }
    }
    try {
      if (oldDoc === activeDoc() && oldDoc.fileSizeBytes >= LARGE_FILE_THRESHOLDS.fileSizeBytes) {
        await showOpeningFeedback(`Reloading large file: ${oldDoc.name}...`);
      }
      const view = snapshotDocumentViewState(oldDoc);
      const freshDoc = await readDocumentFromDisk(oldDoc);
      applyDocumentViewState(freshDoc, view);
      if (isJsonStringView(oldDoc)) freshDoc._isJsonStringView = true;
      resetUndoManagerForDocument(freshDoc);
      if (isVectorLintEngine()) {
        await lspCloseDoc(oldDoc).catch((error) => reportLspCloseFailure(oldDoc, error, "document-reload"));
      }
      state.docs[index] = freshDoc;
      const isActive = index === state.active;
      if (isActive) {
        applyFreezeToDoc(freshDoc);
        grid.setDocument(freshDoc);
        if (freshDoc.selectionState) {
          state.selection.restore(freshDoc.selectionState, freshDoc.rowCount, freshDoc.columnCount);
        }
        if (freshDoc.scrollLeft != null) grid.host.scrollLeft = freshDoc.scrollLeft;
        if (freshDoc.scrollTop != null) grid.host.scrollTop = freshDoc.scrollTop;
        grid.layout();
        grid.draw();
      }
      if (freshDoc.largeFileMode) {
        if (isActive) state.lint.status = `Large file mode: lint paused for ${freshDoc.name}.`;
      } else if (isOpenStatus(state.lint.status)) {
        state.lint.status = "";
      }
      if (!freshDoc.largeFileMode) {
        if (documentOpenSyncRoute(state.lint.engine) === "vector-open") {
          lspOpenDoc(freshDoc).catch((error) => reportLspOpenFailure(freshDoc, error, "document-reload"));
          if (isActive) scheduleHoverPrewarm("document-reloaded");
        } else {
          scheduleLegacyLintFull("document-reloaded", 0);
        }
      }
      updateGridDiagnostics();
      renderChrome();
      if (isActive) scrollProblemsToActiveFile();
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function reloadFile() {
    if (!hasOpenDocument()) {
      showError("No file is open.");
      return false;
    }
    commitActiveEdit();
    saveSelectionState();
    const reloaded = await reloadDocumentAtIndex(state.active);
    if (reloaded) showToast(`Reloaded ${activeDoc().name}.`);
    return reloaded;
  }

  async function reloadAll() {
    if (!hasOpenDocument()) return;
    commitActiveEdit();
    saveSelectionState();
    const previous = state.active;
    let reloaded = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < state.docs.length; i++) {
      if (!canReloadDocument(state.docs[i])) {
        skipped++;
        continue;
      }
      const ok = await reloadDocumentAtIndex(i, { quiet: true });
      if (ok) reloaded++;
      else if (state.docs[i]?.dirty) failed++;
    }
    state.active = previous;
    applyFreezeToDoc(activeDoc());
    grid.setDocument(activeDoc());
    grid.draw();
    renderChrome();
    if (reloaded > 0) showToast(`Reloaded ${reloaded} file(s).`);
    if (failed > 0) showError(`${failed} file(s) could not be reloaded.`);
    else if (reloaded === 0 && skipped === state.docs.length) {
      showError("No saved files are open to reload.");
    }
  }

  function commitActiveEdit() {
    grid.commitEdit?.();
  }

  async function showOpeningFeedback(message) {
    state.lint.status = message;
    renderChrome();
    await yieldToUi();
  }

  function queueSave(doc, save) {
    const previous = pendingSaves.get(doc) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(save);
    pendingSaves.set(doc, queued);
    queued.then(
      () => {
        if (pendingSaves.get(doc) === queued) pendingSaves.delete(doc);
      },
      () => {
        if (pendingSaves.get(doc) === queued) pendingSaves.delete(doc);
      }
    );
    return queued;
  }

  async function writeDocumentText(writable, doc) {
    for (const chunk of doc.toTextChunks()) {
      if (chunk) await writable.write(chunk);
    }
  }

  function isOpenStatus(status) {
    const text = String(status || "");
    return text.startsWith("Large file mode:") || text.startsWith("Opening ");
  }

  return {
    activateDocument,
    addDocument,
    askCloseChoice,
    closeTab,
    commitActiveEdit,
    handleCloseDialogClick,
    hasOpenDocument,
    isTextLikeFile,
    isTextLikePath,
    loadFixture,
    openBrowserFiles,
    openDroppedNativePaths,
    openFile,
    openFolder,
    restoreLastWorkspace,
    reloadAll,
    reloadFile,
    saveAll,
    saveAs,
    saveFile,
    stageDocumentView,
    wireCloseHandler
  };
}

function yieldToUi() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}
