import { TableDocument } from "../../core/table-model.js";
import { readRawTextFiles } from "../../core/platform/file-io.js";
import { makeCellCommand, makeCustomCommand } from "../../core/undo.js";
import {
  buildMissileRemap,
  buildMissileValues,
  buildSkillValues,
  duplicateNameUnchanged,
  findUnchangedDuplicateEntries,
  resolveMissileDuplicate,
  resolveSkillDuplicate
} from "../../core/skill-duplicate.js";

export function createSkillDupController({
  state,
  els,
  grid,
  activeDoc,
  addDocument,
  applyCommandToDocument,
  renderChrome,
  showToast,
  escapeHtml
}) {
  let changeset = null;
  let mode = "skill";

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
    const unchangedMissiles = new Set(
      unchanged.filter((item) => item.kind === "missile").map((item) => item.entry)
    );
    const skillUnchanged = unchanged.some((item) => item.kind === "skill");

    for (const row of els.skillDupBody.querySelectorAll("tr")) {
      const kind = row.dataset.kind;
      const index = Number(row.dataset.index);
      const entry = kind === "skill"
        ? changeset.skill
        : changeset.missiles[changeset.skill ? index - 1 : index];
      const newNameInput = row.querySelector('input[data-field="newName"]');
      if (!newNameInput) continue;
      const needsEdit = kind === "skill"
        ? skillUnchanged && duplicateNameUnchanged(entry.originalName, entry.newName)
        : unchangedMissiles.has(entry);
      newNameInput.classList.toggle("skill-dup-name-unchanged", needsEdit);
    }

    els.skillDupApply.disabled = unchanged.length > 0;
  }

  function renderPreview(nextChangeset) {
    const rows = [];
    if (nextChangeset.skill) rows.push({ kind: "skill", entry: nextChangeset.skill });
    for (const missile of nextChangeset.missiles) rows.push({ kind: "missile", entry: missile });

    els.skillDupBody.innerHTML = rows.map(({ kind, entry }, index) => {
      const rowClass = kind === "skill" ? ' class="skill-row"' : "";
      const targetVal = entry.targetRow >= 0 ? String(entry.targetRow) : "";
      const origCol = kind === "skill" ? "" : escapeHtml(entry.originalName);
      return `<tr${rowClass} data-kind="${kind}" data-index="${index}">
        <td>${kind}</td>
        <td>${origCol}</td>
        <td><input type="text" value="${escapeHtml(entry.newName)}" data-field="newName" /></td>
        <td class="row-num"><input type="text" value="${escapeHtml(targetVal)}" placeholder="append" data-field="targetRow" /></td>
      </tr>`;
    }).join("");

    for (const row of els.skillDupBody.querySelectorAll("tr")) {
      const kind = row.dataset.kind;
      const index = Number(row.dataset.index);
      const entry = kind === "skill" ? nextChangeset.skill : nextChangeset.missiles[nextChangeset.skill ? index - 1 : index];
      for (const input of row.querySelectorAll("input")) {
        input.addEventListener("input", () => {
          if (input.dataset.field === "newName") entry.newName = input.value;
          else {
            const value = Number.parseInt(input.value, 10);
            entry.targetRow = Number.isNaN(value) ? -1 : value;
          }
          refreshPreviewValidation();
        });
      }
    }

    els.skillDupPreview.classList.remove("hidden");
    refreshPreviewValidation();
  }

  function readTargetId(doc, targetRow) {
    for (let column = 0; column < doc.columnCount; column++) {
      if (doc.getCell(0, column).toLowerCase() === "id") {
        if (targetRow >= 1 && targetRow < doc.rowCount) {
          const value = doc.getCell(targetRow, column).trim();
          return value || null;
        }
        return null;
      }
    }
    return null;
  }

  function applyRowWrite(doc, targetRow, values, label) {
    if (targetRow >= 1 && targetRow < doc.rowCount) {
      const edits = values.map((value, column) => ({ row: targetRow, column, value }));
      applyCommandToDocument(doc, makeCellCommand(label, doc, edits));
      return;
    }
    const at = doc.rowCount;
    applyCommandToDocument(doc, makeCustomCommand(label, {
      redo(target) {
        target.insertRow(at, values);
      },
      undo(target) {
        target.deleteRows(at, 1);
      }
    }));
  }

  async function resolve() {
    const sourceName = els.skillDupSource.value.trim();
    const newName = els.skillDupNewName.value.trim();
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
        const result = resolveMissileDuplicate(missilesDoc, sourceName, newName);
        if (result.error) {
          showError(result.error);
          return;
        }
        changeset = result;
        renderPreview(result);
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
      const result = resolveSkillDuplicate(skillsDoc, missilesDoc, sourceName, newName);
      if (result.error) {
        showError(result.error);
        return;
      }
      changeset = result;
      renderPreview(result);
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
    const isMissileMode = mode === "missile";
    const missilesDoc = findDocByName("Missiles.txt");
    if (!missilesDoc) {
      showError("Missiles.txt is no longer open.");
      return;
    }

    const remap = buildMissileRemap(changeset);
    const label = isMissileMode ? "Duplicate Missile" : "Duplicate Skill";

    for (const entry of changeset.missiles) {
      const origSkill = isMissileMode ? null : changeset.skill.originalName;
      const newSkill = isMissileMode ? null : changeset.skill.newName;
      const overrideId = readTargetId(missilesDoc, entry.targetRow) ?? String(missilesDoc.rowCount - 1);
      const values = buildMissileValues(missilesDoc, entry, remap, origSkill, newSkill, overrideId);
      applyRowWrite(missilesDoc, entry.targetRow, values, `${label} - Missile`);
    }

    if (!isMissileMode) {
      const skillsDoc = findDocByName("Skills.txt");
      if (!skillsDoc) {
        showError("Skills.txt is no longer open.");
        return;
      }
      const overrideId = readTargetId(skillsDoc, changeset.skill.targetRow);
      const skillValues = buildSkillValues(skillsDoc, changeset.skill, remap, overrideId);
      applyRowWrite(skillsDoc, changeset.skill.targetRow, skillValues, label);
    }

    const origName = isMissileMode ? changeset.missiles.at(-1)?.originalName : changeset.skill.originalName;
    const newName = isMissileMode ? changeset.missiles.at(-1)?.newName : changeset.skill.newName;
    closeDialog();
    grid.draw();
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
    const isSkillsDoc = /^skills\.txt$/i.test(doc.name);
    const isMissilesDoc = /^missiles\.txt$/i.test(doc.name);
    return [
      { id: "duplicate-skill", label: "Duplicate Skill", disabled: !isSkillsDoc || focusRow < 1 },
      { id: "duplicate-missile", label: "Duplicate Missile", disabled: !isMissilesDoc || focusRow < 1 }
    ];
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
