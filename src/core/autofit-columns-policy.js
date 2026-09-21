export function configuredAutofitColumnIndexes(doc, autofitMap = {}) {
  if (!doc || doc.columnCount <= 0) return [];
  const fileBase = doc.name.replace(/\.[^.]+$/, "").toLowerCase();
  const fileEntry = Object.entries(autofitMap).find(([key]) => key !== "*" && key.toLowerCase() === fileBase)?.[1];
  const globalEntry = autofitMap["*"];
  const fitAll = globalEntry === true || fileEntry === true;
  const fitCols = new Set(fitAll
    ? Array.from({ length: doc.columnCount }, (_, index) => index)
    : [0]);
  if (!fitAll) {
    const autofitSet = new Set([
      ...(Array.isArray(globalEntry) ? globalEntry : []).map((column) => String(column).toLowerCase()),
      ...(Array.isArray(fileEntry) ? fileEntry : []).map((column) => String(column).toLowerCase())
    ]);
    for (let column = 1; column < doc.columnCount; column++) {
      if (autofitSet.has((doc.getCell(0, column) ?? "").toLowerCase())) fitCols.add(column);
    }
  }
  return [...fitCols].filter((column) => column >= 0 && column < doc.columnCount && !doc.hiddenColumns?.has(column));
}
