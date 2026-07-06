import { TableDocument } from "./table-model.js";

export const STRING_KEY_COLUMNS_GLOBAL = new Set(["namestr"]);

export const STRING_KEY_COLUMNS_BY_FILE = {
  uniqueitems: new Set(["index"]),
  setitems: new Set(["index"]),
  sets: new Set(["index"]),
  magicprefix: new Set(["name"]),
  magicsuffix: new Set(["name"]),
  rareprefix: new Set(["name"]),
  raresuffix: new Set(["name"]),
  itemstatcost: new Set(["descstrpos", "descstrneg"]),
  levels: new Set(["levelname", "levelwarp"]),
  misc: new Set(["spelldescstr"]),
  montype: new Set(["strsing", "strplur"]),
  runes: new Set(["name"]),
  superuniques: new Set(["superunique"]),
  skilldesc: new Set([
    "str name", "str short", "str long", "str alt", "str mana",
    "desctexta1", "desctextb1", "desctexta2", "desctextb2", "desctexta3", "desctextb3",
    "desctexta4", "desctextb4", "desctexta5", "desctextb5", "desctexta6", "desctextb6",
    "dsc2texta1", "dsc2textb1", "dsc2texta2", "dsc2textb2", "dsc2texta3", "dsc2textb3",
    "dsc2texta4", "dsc2textb4",
    "dsc3texta1", "dsc3textb1", "dsc3texta2", "dsc3textb2", "dsc3texta3", "dsc3textb3",
    "dsc3texta4", "dsc3textb4", "dsc3texta5", "dsc3textb5", "dsc3texta6", "dsc3textb6",
    "dsc3texta7", "dsc3textb7"
  ])
};

export function isStringKeyCol(colName, fileName) {
  const col = (colName ?? "").toLowerCase();
  if (STRING_KEY_COLUMNS_GLOBAL.has(col)) return true;
  const fileBase = (fileName ?? "").replace(/\.[^.]+$/, "").toLowerCase();
  return STRING_KEY_COLUMNS_BY_FILE[fileBase]?.has(col) ?? false;
}

export function isJsonStringView(doc) {
  return Boolean(doc?._isJsonStringView);
}

export function tableDocumentFromJsonStrings(name, filePath, jsonText) {
  let entries;
  try {
    entries = JSON.parse(jsonText);
  } catch {
    entries = [];
  }
  const rows = [["Key", "Value"]];
  for (const entry of entries) {
    if (typeof entry !== "object" || !entry) continue;
    rows.push([entry.Key ?? "", (entry.Value ?? "").replace(/\n/g, "\\n")]);
  }
  const tsv = rows.map((row) => row.map((cell) => String(cell).replace(/\t/g, " ")).join("\t")).join("\n");
  const doc = TableDocument.fromText(name, tsv);
  doc.path = filePath;
  doc._isJsonStringView = true;
  return doc;
}

export function serializeJsonStringView(doc) {
  const entries = [];
  for (let row = 1; row < doc.rowCount; row++) {
    const key = doc.getCell(row, 0) ?? "";
    const value = (doc.getCell(row, 1) ?? "").replace(/\\n/g, "\n");
    if (key) entries.push({ Key: key, Value: value });
  }
  return JSON.stringify(entries, null, 1);
}
