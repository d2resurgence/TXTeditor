import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import {
  applyDocumentViewState,
  canReloadDocument,
  clampSelectionSnapshot,
  reloadDialogMessage,
  snapshotDocumentViewState
} from "../src/ui/document-reload-policy.js";

test("canReloadDocument requires a saved file path", () => {
  assert.equal(canReloadDocument(TableDocument.fromText("Untitled.txt", "a\tb")), false);
  assert.equal(canReloadDocument(TableDocument.fromText("skills.txt", "a\tb", { path: "D:\\mods\\skills.txt" })), true);
});

test("reloadDialogMessage describes discarding unsaved edits", () => {
  const doc = TableDocument.fromText("skills.txt", "a\tb");
  assert.match(reloadDialogMessage(doc), /Reload anyway and discard them/);
});

test("snapshot and apply preserve view state across document replacement", () => {
  const oldDoc = TableDocument.fromText("skills.txt", "a\tb\n1\t2", { path: "skills.txt" });
  oldDoc.zoom = 1.4;
  oldDoc.freezeFirstRow = true;
  oldDoc.columnWidths = [80, 140];
  oldDoc.scrollLeft = 12;
  oldDoc.scrollTop = 34;
  oldDoc.selectionState = {
    anchor: { row: 1, column: 1 },
    focus: { row: 1, column: 1 },
    ranges: [{ top: 1, left: 1, bottom: 1, right: 1 }]
  };

  const snapshot = snapshotDocumentViewState(oldDoc);
  const newDoc = TableDocument.fromText("skills.txt", "x\ty\n9\t8", { path: "skills.txt" });

  applyDocumentViewState(newDoc, snapshot);

  assert.equal(newDoc.zoom, 1.4);
  assert.equal(newDoc.freezeFirstRow, true);
  assert.deepEqual(newDoc.columnWidths, [80, 140]);
  assert.equal(newDoc.scrollLeft, 12);
  assert.equal(newDoc.scrollTop, 34);
  assert.deepEqual(newDoc.selectionState.focus, { row: 1, column: 1 });
});

test("clampSelectionSnapshot keeps selection inside the reloaded table", () => {
  const clamped = clampSelectionSnapshot({
    anchor: { row: 9, column: 4 },
    focus: { row: 9, column: 4 },
    ranges: [{ top: 8, left: 3, bottom: 9, right: 4 }]
  }, 3, 2);
  assert.deepEqual(clamped.focus, { row: 2, column: 1 });
  assert.deepEqual(clamped.ranges, [{ top: 2, left: 1, bottom: 2, right: 1 }]);
});
