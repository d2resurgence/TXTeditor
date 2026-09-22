import { TableDocument } from "../../core/table-model.js";
import { readRawTextFiles } from "../../core/platform/file-io.js";
import { makeCellCommand, makeCustomCommand } from "../../core/undo.js";
import {
  EXCLUDE_DEFAULT,
  PROC_SKILL_ID_LIMIT,
  buildMissileRemap,
  buildMissileValues,
  buildSkillValues,
  duplicateNameUnchanged,
  findUnchangedDuplicateEntries,
  resolveMissileDuplicate,
  resolveSkillDuplicate,
  rowForId
} from "../../core/skill-duplicate.js";

export function createSkillDupController({
  state,
  els,
  grid,
  activeDoc,
  addDocument,
  activateDocument,
  stageDocumentView,
  applyCommandToDocument,
  saveSelectionState,
  commitActiveEdit,
  renderChrome,
  showToast,
  escapeHtml
}) {
  let changeset = null;
  let mode = "skill";
  // Missiles from EXCLUDE_DEFAULT the user chose to duplicate anyway, lowercased.
  let forcedMissiles = new Set();
  // Missiles the user unticked in the preview, lowercased.
  let removedMissiles = new Set();

  function findDocByName(name) {
    return state.docs.find((doc) => doc.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async function ensureDoc(filename) {
    const existing = findDocByName(filename);
    if (existing) return existing;
    if (!state.workspace) return null;
    const candidate = state.workspace.files?.find((file) => file.name.toLowerCase() === filename.toLowerCase());
    if (!candidate) return null;
    const [file] = await readRawTextFiles([candidate.path]).catch(() => []);
    if (!file?.text) return null;
    const doc = TableDocument.fromText(candidate.name, file.text, { path: candidate.path, dirty: false });
    await addDocument(doc);
    return doc;
  }

  function showError(message) {
    els.skillDupError.textContent = message;
    els.skillDupError.classList.remove("hidden");
  }

  function clearError() {
    els.skillDupError.classList.add("hidden");
  }

  function setMode(nextMode) {
    mode = nextMode;
    forcedMissiles = new Set();
    removedMissiles = new Set();
    els.skillDupModeSkill.classList.toggle("active", nextMode === "skill");
    els.skillDupModeMissile.classList.toggle("active", nextMode === "missile");
    els.skillDupSourceLabel.textContent = nextMode === "skill" ? "Source skill" : "Source missile";
    clearError();
    els.skillDupPreview.classList.add("hidden");
    changeset = null;
    els.skillDupSource.value = "";
    els.skillDupNewName.value = "";
    els.skillDupSource.focus();
  }

  function showDialog(nextMode = "skill", prefill = null) {
    els.skillDupDialog.classList.remove("hidden");
    clearError();
    els.skillDupPreview.classList.add("hidden");
    changeset = null;
    mode = nextMode;
    els.skillDupModeSkill.classList.toggle("active", nextMode === "skill");
    els.skillDupModeMissile.classList.toggle("active", nextMode === "missile");
    els.skillDupSourceLabel.textContent = nextMode === "skill" ? "Source skill" : "Source missile";

    if (prefill != null) {
      els.skillDupSource.value = prefill;
      els.skillDupNewName.value = prefill;
    } else {
      const doc = activeDoc();
      const colName = nextMode === "skill" ? "skill" : "missile";
      const row = state.contextHit?.row ?? state.selection.focus.row;
      if (row > 0) {
        const colIdx = Array.from({ length: doc.columnCount }, (_, column) => column)
          .find((column) => doc.getCell(0, column).toLowerCase() === colName);
        if (colIdx != null) {
          const name = doc.getCell(row, colIdx);
          els.skillDupSource.value = name;
          els.skillDupNewName.value = name;
        }
      }
    }
    els.skillDupSource.focus();
  }

  function closeDialog() {
    els.skillDupDialog.classList.add("hidden");
    changeset = null;
  }

  function refreshPreviewValidation() {
    if (!changeset) return;
    const unchanged = findUnchangedDuplicateEntries(changeset);
    const previewed = previewRows(changeset);
    const unchangedMissiles = new Set(
      unchanged.filter((item) => item.kind === "missile").map((item) => item.entry)
    );
    const skillUnchanged = unchanged.some((item) => item.kind === "skill");

    for (const row of els.skillDupBody.querySelectorAll("tr")) {
      const kind = row.dataset.kind;
      const entry = previewed[Number(row.dataset.index)]?.entry;
      const newNameInput = row.querySelector('input[data-field="newName"]');
      if (!entry || !newNameInput) continue;
      const needsEdit = entry.excluded
        ? false
        : kind === "skill"
          ? skillUnchanged && duplicateNameUnchanged(entry.originalName, entry.newName)
          : unchangedMissiles.has(entry);
      newNameInput.classList.toggle("skill-dup-name-unchanged", needsEdit);
    }

    els.skillDupApply.disabled = unchanged.length > 0;
  }

  function previewRows(nextChangeset) {
    const rows = [];
    if (nextChangeset.skill) rows.push({ kind: "skill", entry: nextChangeset.skill });
    const missiles = [
      ...nextChangeset.missiles.map((entry) => ({ kind: "missile", entry })),
      ...(nextChangeset.excludedMissiles ?? []).map((entry) => ({ kind: "missile", entry }))
    ].sort((a, b) => a.entry.sourceRow - b.entry.sourceRow);
    return rows.concat(missiles);
  }

  function renderPreview(nextChangeset) {
    const rows = previewRows(nextChangeset);

    els.skillDupBody.innerHTML = rows.map(({ kind, entry }, index) => {
      const excluded = Boolean(entry.excluded);
      const classes = [kind === "skill" ? "skill-row" : "", excluded ? "skill-dup-excluded-row" : ""].filter(Boolean);
      const rowClass = classes.length ? ` class="${classes.join(" ")}"` : "";
      const targetVal = entry.targetId != null ? String(entry.targetId) : "";
      // The root of a missile-mode duplicate is the thing being duplicated, so it cannot be dropped.
      const isRoot = mode === "missile"
        && entry.originalName.trim().toLowerCase() === els.skillDupSource.value.trim().toLowerCase();
      const include = kind === "missile"
        ? `<input type="checkbox" data-field="include"${excluded ? "" : " checked"}${isRoot ? " disabled" : ""} title="${isRoot ? "The source missile is always duplicated" : "Include this missile in the duplicate"}" />`
        : "";
      const disabled = excluded ? " disabled" : "";
      return `<tr${rowClass} data-kind="${kind}" data-index="${index}">
        <td class="skill-dup-include">${include}</td>
        <td>${kind}</td>
        <td>${escapeHtml(entry.originalName)}</td>
        <td><input type="text" value="${escapeHtml(entry.newName)}" data-field="newName"${disabled} /></td>
        <td class="row-num"><input type="text" value="${escapeHtml(targetVal)}" placeholder="append" data-field="targetId"${disabled} /></td>
      </tr>`;
    }).join("");

    for (const row of els.skillDupBody.querySelectorAll("tr")) {
      const entry = rows[Number(row.dataset.index)].entry;
      const include = row.querySelector('input[data-field="include"]');
      include?.addEventListener("change", () => {
        const name = entry.originalName.trim().toLowerCase();
        if (include.checked) {
          removedMissiles.delete(name);
          if (EXCLUDE_DEFAULT.has(name)) forcedMissiles.add(name);
        } else {
          forcedMissiles.delete(name);
          if (!EXCLUDE_DEFAULT.has(name)) removedMissiles.add(name);
        }
        resolve({ keepEdits: true }).catch((error) => showError(error instanceof Error ? error.message : String(error)));
      });
      for (const input of row.querySelectorAll('input[type="text"]')) {
        input.addEventListener("input", () => {
          if (input.dataset.field === "newName") entry.newName = input.value;
          else entry.targetId = input.value.trim() === "" ? null : input.value.trim();
          refreshPreviewValidation();
        });
      }
    }

    els.skillDupPreview.classList.remove("hidden");
    refreshPreviewValidation();
  }

  // An entry's target is an Id: an existing one overwrites that row, a new one appends.
  function targetRowFor(doc, entry) {
    return rowForId(doc, entry?.targetId ?? null);
  }

  function columnIndexForName(doc, columnName) {
    const needle = columnName.toLowerCase();
    for (let column = 0; column < doc.columnCount; column++) {
      if (doc.getCell(0, column).trim().toLowerCase() === needle) return column;
    }
    return -1;
  }

  function unhideRows(doc, rows) {
    let changed = false;
    for (const row of rows) {
      if (doc.hiddenRows?.has(row)) {
        doc.hiddenRows.delete(row);
        changed = true;
      }
    }
    if (changed) doc.markViewChanged();
  }

  function resolveMissileFocusRow(doc, entries, appliedRows, sourceNameLower) {
    const maxRow = Math.max(1, doc.rowCount - 1);
    const rowFromEntry = (entry, applied) => {
      const targetRow = targetRowFor(doc, entry);
      if (targetRow >= 1 && targetRow <= maxRow) return targetRow;
      if (applied != null && applied >= 1 && applied <= maxRow) return Number(applied);
      return null;
    };

    const sourceIndex = entries.findIndex((entry) => entry.originalName.toLowerCase() === sourceNameLower);
    if (sourceIndex >= 0) {
      const row = rowFromEntry(entries[sourceIndex], appliedRows[sourceIndex]);
      if (row != null) return row;
    }
    for (let i = 0; i < entries.length; i++) {
      const row = rowFromEntry(entries[i], appliedRows[i]);
      if (row != null) return row;
    }
    return -1;
  }

  function missileRowsToFocus(doc, entries, appliedRows) {
    const maxRow = Math.max(1, doc.rowCount - 1);
    return [...new Set(entries.map((entry, index) => {
      const targetRow = targetRowFor(doc, entry);
      if (targetRow >= 1 && targetRow <= maxRow) return targetRow;
      const applied = appliedRows[index];
      return applied != null ? Number(applied) : null;
    }).filter((row) => row != null && Number.isFinite(row) && row >= 1 && row <= maxRow))].sort((a, b) => a - b);
  }

  function resolveAppliedRow(doc, entry, applied) {
    const maxRow = Math.max(1, doc.rowCount - 1);
    const targetRow = targetRowFor(doc, entry);
    if (targetRow >= 1 && targetRow <= maxRow) return targetRow;
    const row = Number(applied);
    return Number.isFinite(row) && row >= 1 && row <= maxRow ? row : -1;
  }

  function buildSelectionSnapshot(doc, rows, column, focusRow) {
    const lastCol = Math.max(0, doc.columnCount - 1);
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const contiguous = lastRow - firstRow === rows.length - 1;
    return {
      anchor: { row: firstRow, column },
      focus: { row: focusRow, column },
      ranges: contiguous
        ? [{ top: firstRow, left: 0, bottom: lastRow, right: lastCol }]
        : rows.map((row) => ({ top: row, left: 0, bottom: row, right: lastCol }))
    };
  }

  function activateDocumentTab(doc) {
    if (state.docs.indexOf(doc) === state.active) return;
    activateDocument(doc);
  }

  function focusCellInDocument(doc, row, columnName) {
    const column = Math.max(0, columnIndexForName(doc, columnName));
    const maxRow = Math.max(1, doc.rowCount - 1);
    if (!(row >= 1 && row <= maxRow)) return false;

    unhideRows(doc, [row]);
    activateDocumentTab(doc);
    if (grid.doc !== doc) grid.setDocument(doc);

    state.selection.set(row, column);
    saveSelectionState(doc);
    grid.layout();
    grid.scrollCellIntoView(row, column);
    doc.scrollLeft = grid.scrollLeft;
    doc.scrollTop = grid.scrollTop;
    grid.draw();
    els.host?.focus();
    return true;
  }

  function stageRowsOnDocument(doc, rows, columnName) {
    const column = Math.max(0, columnIndexForName(doc, columnName));
    const maxRow = Math.max(1, doc.rowCount - 1);
    const validRows = [...new Set(
      rows.filter((row) => Number.isFinite(row) && row >= 1 && row <= maxRow)
    )].sort((a, b) => a - b);
    if (!validRows.length) return false;

    unhideRows(doc, validRows);
    const resolvedFocusRow = validRows[validRows.length - 1];
    const snapshot = buildSelectionSnapshot(doc, validRows, column, resolvedFocusRow);
    stageDocumentView(doc, snapshot, resolvedFocusRow, column);
    return true;
  }

  function applyRowWrite(doc, targetRow, values, label, options = {}) {
    if (targetRow >= 1 && targetRow < doc.rowCount) {
      const edits = values.map((value, column) => ({ row: targetRow, column, value }));
      const command = makeCellCommand(label, doc, edits);
      if (command.isEmpty) return null;
      applyCommandToDocument(doc, command, options);
      return targetRow;
    }
    const at = doc.rowCount;
    applyCommandToDocument(doc, makeCustomCommand(label, {
      redo(target) {
        target.insertRow(at, values);
      },
      undo(target) {
        target.deleteRows(at, 1);
      }
    }), options);
    return at;
  }

  function activeExclusions() {
    const exclusions = new Set([...EXCLUDE_DEFAULT, ...removedMissiles]);
    for (const name of forcedMissiles) exclusions.delete(name);
    return exclusions;
  }

  // Ticking a client-only missile re-resolves so its own sub-missiles come along;
  // the names and ids already edited in the panel are carried over.
  function captureEdits() {
    if (!changeset) return null;
    const edits = new Map();
    for (const { entry } of previewRows(changeset)) {
      edits.set(entry.originalName.trim().toLowerCase(), { newName: entry.newName, targetId: entry.targetId });
    }
    return edits;
  }

  function restoreEdits(nextChangeset, edits) {
    if (!edits) return nextChangeset;
    for (const { entry } of previewRows(nextChangeset)) {
      const previous = edits.get(entry.originalName.trim().toLowerCase());
      if (!previous) continue;
      entry.newName = previous.newName;
      if (!entry.excluded && previous.targetId != null) entry.targetId = previous.targetId;
    }
    return nextChangeset;
  }

  async function resolve({ keepEdits = false } = {}) {
    const sourceName = els.skillDupSource.value.trim();
    const newName = els.skillDupNewName.value.trim();
    const edits = keepEdits ? captureEdits() : null;
    const isProc = Boolean(els.skillDupProc?.checked);
    clearError();
    els.skillDupPreview.classList.add("hidden");

    const isMissileMode = mode === "missile";
    if (!sourceName) {
      showError(`Enter a source ${isMissileMode ? "missile" : "skill"} name.`);
      return;
    }
    if (!newName) {
      showError(`Enter a new ${isMissileMode ? "missile" : "skill"} name.`);
      return;
    }

    try {
      if (isMissileMode) {
        const missilesDoc = await ensureDoc("Missiles.txt");
        if (!missilesDoc) {
          showError("Missiles.txt is not open and could not be found in the workspace.");
          return;
        }
        const result = resolveMissileDuplicate(missilesDoc, sourceName, newName, activeExclusions());
        if (result.error) {
          showError(result.error);
          return;
        }
        changeset = restoreEdits(result, edits);
        renderPreview(changeset);
        return;
      }

      const skillsDoc = await ensureDoc("Skills.txt");
      if (!skillsDoc) {
        showError("Skills.txt is not open and could not be found in the workspace.");
        return;
      }
      const missilesDoc = await ensureDoc("Missiles.txt");
      if (!missilesDoc) {
        showError("Missiles.txt is not open and could not be found in the workspace.");
        return;
      }
      const result = resolveSkillDuplicate(skillsDoc, missilesDoc, sourceName, newName, activeExclusions(), { isProc });
      if (result.error) {
        showError(result.error);
        return;
      }
      if (isProc && result.skill.targetId == null) {
        showError(`No free skill Id below ${PROC_SKILL_ID_LIMIT + 1} is available for a proc skill.`);
        return;
      }
      changeset = restoreEdits(result, edits);
      renderPreview(changeset);
      activateDocument(skillsDoc);
      els.skillDupNewName.focus();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function apply() {
    if (!changeset) return;
    const unchanged = findUnchangedDuplicateEntries(changeset);
    if (unchanged.length) {
      const missileNames = unchanged
        .filter((item) => item.kind === "missile")
        .map((item) => item.entry.originalName);
      if (missileNames.length) {
        showError(`Set a new name for: ${missileNames.join(", ")}`);
      } else {
        showError("Set a new skill name before applying.");
      }
      refreshPreviewValidation();
      return;
    }
    clearError();
    commitActiveEdit?.();
    const isMissileMode = mode === "missile";
    const missilesDoc = findDocByName("Missiles.txt");
    if (!missilesDoc) {
      showError("Missiles.txt is no longer open.");
      return;
    }

    const remap = buildMissileRemap(changeset);
    const label = isMissileMode ? "Duplicate Missile" : "Duplicate Skill";
    const focusDoc = isMissileMode ? missilesDoc : findDocByName("Skills.txt");
    const sourceName = els.skillDupSource.value.trim().toLowerCase();

    if (!focusDoc) {
      showError(`${isMissileMode ? "Missiles.txt" : "Skills.txt"} is no longer open.`);
      return;
    }

    const writeOptions = { deferSideEffects: true };
    const appliedMissileRows = [];
    for (const entry of changeset.missiles) {
      const origSkill = isMissileMode ? null : changeset.skill.originalName;
      const newSkill = isMissileMode ? null : changeset.skill.newName;
      const overrideId = entry.targetId != null ? String(entry.targetId) : null;
      const values = buildMissileValues(missilesDoc, entry, remap, origSkill, newSkill, overrideId);
      appliedMissileRows.push(applyRowWrite(missilesDoc, targetRowFor(missilesDoc, entry), values, `${label} - Missile`, writeOptions));
    }

    let appliedSkillRow = -1;
    if (!isMissileMode) {
      const skillsDoc = findDocByName("Skills.txt");
      if (!skillsDoc) {
        showError("Skills.txt is no longer open.");
        return;
      }
      const overrideId = changeset.skill.targetId != null ? String(changeset.skill.targetId) : null;
      const skillValues = buildSkillValues(skillsDoc, changeset.skill, remap, overrideId);
      appliedSkillRow = applyRowWrite(skillsDoc, targetRowFor(skillsDoc, changeset.skill), skillValues, label, writeOptions);
    }

    const origName = isMissileMode ? changeset.missiles.at(-1)?.originalName : changeset.skill.originalName;
    const newName = isMissileMode ? changeset.missiles.at(-1)?.newName : changeset.skill.newName;
    const missileRows = missileRowsToFocus(missilesDoc, changeset.missiles, appliedMissileRows);
    const skillFocusRow = !isMissileMode
      ? resolveAppliedRow(focusDoc, changeset.skill, appliedSkillRow)
      : -1;
    const missileFocusRow = isMissileMode
      ? resolveMissileFocusRow(missilesDoc, changeset.missiles, appliedMissileRows, sourceName)
      : -1;

    closeDialog();
    grid.layout();
    grid.draw();

    if (isMissileMode) {
      focusCellInDocument(missilesDoc, missileFocusRow, "missile");
    } else {
      activateDocumentTab(focusDoc);
      if (missileRows.length) {
        stageRowsOnDocument(missilesDoc, missileRows, "missile");
      }
      focusCellInDocument(focusDoc, skillFocusRow, "skill");
    }

    renderChrome();
    showToast(`Duplicated "${origName}" → "${newName}"`);
  }

  function runFromCommand(commandId) {
    const doc = activeDoc();
    const hitRow = state.contextHit?.row;
    if (commandId === "duplicate-skill") {
      if (hitRow != null && hitRow > 0 && /^skills\.txt$/i.test(doc.name)) {
        const skillColIdx = Array.from({ length: doc.columnCount }, (_, column) => column)
          .find((column) => doc.getCell(0, column).toLowerCase() === "skill");
        const prefill = skillColIdx != null ? doc.getCell(hitRow, skillColIdx) : "";
        return showDialog("skill", prefill || null);
      }
      return showDialog("skill");
    }
    if (commandId === "duplicate-missile") {
      if (hitRow != null && hitRow > 0 && /^missiles\.txt$/i.test(doc.name)) {
        const missileColIdx = Array.from({ length: doc.columnCount }, (_, column) => column)
          .find((column) => doc.getCell(0, column).toLowerCase() === "missile");
        const prefill = missileColIdx != null ? doc.getCell(hitRow, missileColIdx) : "";
        return showDialog("missile", prefill || null);
      }
      return showDialog("missile");
    }
  }

  function contextMenuEntries({ focusRow, doc }) {
    const entries = [];
    if (focusRow >= 1 && /^skills\.txt$/i.test(doc.name)) {
      entries.push({ id: "duplicate-skill", label: "Duplicate Skill" });
    }
    if (focusRow >= 1 && /^missiles\.txt$/i.test(doc.name)) {
      entries.push({ id: "duplicate-missile", label: "Duplicate Missile" });
    }
    return entries;
  }

  function wireEvents() {
    els.skillDupClose.addEventListener("click", closeDialog);
    els.skillDupCancel.addEventListener("click", closeDialog);
    els.skillDupResolve.addEventListener("click", () => {
      resolve().catch((error) => showError(error instanceof Error ? error.message : String(error)));
    });
    els.skillDupModeSkill.addEventListener("click", () => setMode("skill"));
    els.skillDupModeMissile.addEventListener("click", () => setMode("missile"));
    els.skillDupApply.addEventListener("click", apply);
    els.skillDupProc?.addEventListener("change", () => {
      if (changeset) resolve({ keepEdits: true }).catch((error) => showError(error instanceof Error ? error.message : String(error)));
    });
    els.skillDupSource.addEventListener("keydown", (event) => {
      if (event.key === "Enter") resolve().catch((error) => showError(error instanceof Error ? error.message : String(error)));
    });
    els.skillDupNewName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") resolve().catch((error) => showError(error instanceof Error ? error.message : String(error)));
    });
  }

  return {
    closeDialog,
    contextMenuEntries,
    runFromCommand,
    showDialog,
    wireEvents
  };
}
