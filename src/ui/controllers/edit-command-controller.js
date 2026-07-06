import {
  addColumnsCommand,
  addRowsCommand,
  arithmeticRangesCommand,
  arithmeticCommand,
  clearRangesCommand,
  copyRanges,
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand
} from "../../core/operations.js";
import {
  readClipboardText,
  writeClipboardText
} from "../app-runtime-utils.js";
import { rowsFromRanges } from "../row-operation-policy.js";

export function createEditCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  execute,
  saveSelectionState,
  promptNumber,
  showError
}) {
  async function copySelection() {
    if (!hasOpenDocument()) return;
    try {
      await writeClipboardText(copyRanges(activeDoc(), state.selection.ranges));
    } catch (error) {
      showError(`Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function cutSelection() {
    await copySelection();
    execute(clearRangesCommand(activeDoc(), state.selection.ranges, "Cut"));
  }

  async function pasteSelection() {
    if (!hasOpenDocument()) return;
    try {
      const text = await readClipboardText();
      execute(pasteTextToRangesCommand(activeDoc(), state.selection.ranges, state.selection.focus, text));
    } catch (error) {
      showError(`Clipboard paste failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function selectAll() {
    state.selection.selectAll(activeDoc().rowCount, activeDoc().columnCount);
    saveSelectionState();
    grid.draw();
  }

  async function addRows() {
    const count = await promptNumber({
      title: "Add Rows",
      message: "Number of rows to add:",
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(addRowsCommand(activeDoc(), count));
  }

  function selectedDataRowCount(doc) {
    const rows = [...new Set(
      rowsFromRanges(state.selection.ranges).filter((row) => row > 0 && row < doc.rowCount)
    )];
    return Math.max(1, rows.length);
  }

  async function insertRows() {
    const doc = activeDoc();
    const countFromSelection = selectedDataRowCount(doc);
    let count = countFromSelection;
    if (countFromSelection === 1) {
      const prompted = await promptNumber({
        title: "Insert Rows",
        message: "Number of rows to insert:",
        defaultValue: 1,
        min: 1
      });
      if (prompted === null) return;
      count = prompted;
    }
    execute(insertRowCommand(doc, state.selection.rect.top, count));
  }

  function insertRowsQuick() {
    if (!hasOpenDocument()) return;
    const doc = activeDoc();
    execute(insertRowCommand(doc, state.selection.rect.top, selectedDataRowCount(doc)));
  }

  async function addColumns() {
    const count = await promptNumber({
      title: "Add Columns",
      message: "Number of columns to add:",
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(addColumnsCommand(activeDoc(), count));
  }

  async function insertColumns() {
    const count = await promptNumber({
      title: "Insert Columns",
      message: "Number of columns to insert:",
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(insertColumnCommand(activeDoc(), state.selection.rect.left, count));
  }

  async function math(kind) {
    const operator = { add: "+", subtract: "-", multiply: "*", divide: "/" }[kind];
    const operand = await promptNumber({
      title: "Math",
      message: `Apply ${operator} to numeric selected cells:`,
      defaultValue: "",
      allowFloat: true
    });
    if (operand !== null) execute(state.selection.isMultiRange
      ? arithmeticRangesCommand(activeDoc(), state.selection.ranges, operator, operand)
      : arithmeticCommand(activeDoc(), state.selection.rect, operator, operand));
  }

  return {
    copySelection,
    cutSelection,
    pasteSelection,
    selectAll,
    addRows,
    insertRows,
    insertRowsQuick,
    addColumns,
    insertColumns,
    math
  };
}
