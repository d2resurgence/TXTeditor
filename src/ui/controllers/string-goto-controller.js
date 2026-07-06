import { clamp } from "../../core/table-model.js";
import { readRawTextFiles, writeRawTextFile } from "../../core/platform/file-io.js";
import { isTauriRuntime } from "../../core/platform/tauri-api.js";
import { applySavedTextPayload } from "../../core/platform/file-payloads.js";
import { tableFileState } from "../../core/table-file-state.js";
import {
  buildStringIndex,
  clearStringIndex,
  findStringKey,
  isStringIndexLoaded
} from "../../core/string-table.js";
import {
  isJsonStringView,
  isStringKeyCol,
  serializeJsonStringView,
  tableDocumentFromJsonStrings
} from "../../core/string-goto-policy.js";

const STRING_FILES = ["string.json", "patchstring.json", "expansionstring.json"];

export function createStringGotoController({
  state,
  grid,
  activeDoc,
  addDocument,
  applyFreezeToDoc,
  updateGridDiagnostics,
  updateActiveProblemHighlight,
  renderChrome,
  saveSelectionState,
  els,
  showToast
}) {
  async function loadStringTablesForWorkspace(workspacePath, stringsPath = null) {
    clearStringIndex();
    if (!isTauriRuntime()) return;
    const sep = workspacePath.includes("\\") ? "\\" : "/";
    const configuredPath = stringsPath ?? state.config?.stringsPath ?? null;
    if (configuredPath) {
      const paths = STRING_FILES.map((file) => `${configuredPath}${sep}${file}`);
      buildStringIndex(await readRawTextFiles(paths).catch(() => []));
      return;
    }
    const parts = workspacePath.replace(/[\\/]+$/, "").split(/[\\/]/);
    for (let up = 0; up <= 2; up++) {
      if (parts.length - up < 2) break;
      const dir = [...parts.slice(0, parts.length - up), "local", "LNG", "ENG"].join(sep);
      const paths = STRING_FILES.map((file) => `${dir}${sep}${file}`);
      const files = await readRawTextFiles(paths).catch(() => []);
      if (files.some((file) => file.text != null)) {
        buildStringIndex(files);
        return;
      }
    }
    buildStringIndex([]);
  }

  async function openJsonAndNavigate(filePath, entryIndex) {
    let index = state.docs.findIndex((doc) => isJsonStringView(doc) && doc.path === filePath);
    if (index < 0) {
      const [file] = await readRawTextFiles([filePath]).catch(() => []);
      if (!file?.text) {
        showToast("Could not read string file.");
        return;
      }
      const name = filePath.split(/[\\/]/).pop();
      await addDocument(tableDocumentFromJsonStrings(name, filePath, file.text));
      index = state.active;
    } else if (index !== state.active) {
      state.active = index;
      applyFreezeToDoc(activeDoc());
      grid.setDocument(activeDoc());
      updateGridDiagnostics();
    }
    const targetRow = clamp(entryIndex + 1, 0, Math.max(0, activeDoc().rowCount - 1));
    state.selection.set(targetRow, 0);
    saveSelectionState();
    grid.scrollCellIntoView(targetRow, 0);
    grid.draw();
    updateActiveProblemHighlight();
    renderChrome();
    els.host.focus();
  }

  function cellHasStringReference(_row, col) {
    const doc = activeDoc();
    return isStringIndexLoaded() && isStringKeyCol(doc.getCell(0, col), doc.name);
  }

  async function tryGoToStringDefinition(row, col) {
    const doc = activeDoc();
    if (!isStringIndexLoaded() || !isStringKeyCol(doc.getCell(0, col), doc.name)) return false;
    const cellValue = doc.getCell(row, col);
    const entry = cellValue ? findStringKey(cellValue) : null;
    if (!entry) return false;
    await openJsonAndNavigate(entry.filePath, entry.entryIndex);
    return true;
  }

  async function saveJsonStringViewIfNeeded(doc) {
    if (!isJsonStringView(doc) || !isTauriRuntime()) return false;
    const revision = tableFileState(doc).revision;
    const payload = await writeRawTextFile(doc.path, serializeJsonStringView(doc));
    applySavedTextPayload(doc, payload, revision);
    return true;
  }

  return {
    cellHasStringReference,
    loadStringTablesForWorkspace,
    saveJsonStringViewIfNeeded,
    tryGoToStringDefinition
  };
}
