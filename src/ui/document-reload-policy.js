import { RangeSet } from "../core/range-set.js";

export function canReloadDocument(doc) {
  return Boolean(String(doc?.path ?? "").trim());
}

export function reloadDialogMessage(doc) {
  return `${doc.name} has unsaved changes. Reload anyway and discard them?`;
}

export function snapshotDocumentViewState(doc) {
  if (!doc) return null;
  return {
    zoom: doc.zoom,
    columnWidths: [...(doc.columnWidths ?? [])],
    rowHeights: [...(doc.rowHeights ?? [])],
    defaultColumnWidth: doc.defaultColumnWidth,
    defaultRowHeight: doc.defaultRowHeight,
    hasCustomRowHeights: doc.hasCustomRowHeights,
    hiddenRows: RangeSet.from(doc.hiddenRows),
    hiddenColumns: RangeSet.from(doc.hiddenColumns),
    freezeFirstRow: doc.freezeFirstRow,
    freezeFirstColumn: doc.freezeFirstColumn,
    scrollLeft: doc.scrollLeft,
    scrollTop: doc.scrollTop,
    selectionState: cloneSelectionSnapshot(doc.selectionState),
    initialColumnFitApplied: doc.initialColumnFitApplied,
    handle: doc.handle ?? null
  };
}

export function applyDocumentViewState(doc, snapshot) {
  if (!doc || !snapshot) return;
  doc.zoom = snapshot.zoom ?? doc.zoom;
  doc.freezeFirstRow = Boolean(snapshot.freezeFirstRow);
  doc.freezeFirstColumn = Boolean(snapshot.freezeFirstColumn);
  doc.hiddenRows = RangeSet.from(snapshot.hiddenRows);
  doc.hiddenColumns = RangeSet.from(snapshot.hiddenColumns);
  doc.defaultColumnWidth = snapshot.defaultColumnWidth ?? doc.defaultColumnWidth;
  doc.defaultRowHeight = snapshot.defaultRowHeight ?? doc.defaultRowHeight;
  doc.hasCustomRowHeights = Boolean(snapshot.hasCustomRowHeights);
  if (snapshot.columnWidths?.length) {
    doc.columnWidths = snapshot.columnWidths.slice(0, doc.columnCount);
    while (doc.columnWidths.length < doc.columnCount) {
      doc.columnWidths.push(doc.defaultColumnWidth);
    }
  }
  if (snapshot.rowHeights?.length) {
    doc.rowHeights = snapshot.rowHeights.slice(0, doc.rowCount);
    while (doc.rowHeights.length < doc.rowCount) {
      doc.rowHeights.push(doc.defaultRowHeight);
    }
  }
  doc.scrollLeft = snapshot.scrollLeft;
  doc.scrollTop = snapshot.scrollTop;
  doc.initialColumnFitApplied = snapshot.initialColumnFitApplied ?? true;
  doc.selectionState = clampSelectionSnapshot(snapshot.selectionState, doc.rowCount, doc.columnCount);
  if (snapshot.handle) doc.handle = snapshot.handle;
}

export function clampSelectionSnapshot(snapshot, rowCount, columnCount) {
  if (!snapshot || rowCount <= 0 || columnCount <= 0) return null;
  const maxRow = rowCount - 1;
  const maxCol = columnCount - 1;
  const clampCell = ({ row, column }) => ({
    row: Math.max(0, Math.min(maxRow, row)),
    column: Math.max(0, Math.min(maxCol, column))
  });
  return {
    anchor: clampCell(snapshot.anchor),
    focus: clampCell(snapshot.focus),
    ranges: snapshot.ranges.map((range) => ({
      top: Math.max(0, Math.min(maxRow, range.top)),
      left: Math.max(0, Math.min(maxCol, range.left)),
      bottom: Math.max(0, Math.min(maxRow, range.bottom)),
      right: Math.max(0, Math.min(maxCol, range.right))
    }))
  };
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
