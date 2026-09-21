import assert from "node:assert/strict";
import test from "node:test";
import { configuredAutofitColumnIndexes } from "../src/core/autofit-columns-policy.js";
import { TableDocument } from "../src/core/table-model.js";

test("configuredAutofitColumnIndexes fits all columns when global autofit is true", () => {
  const doc = TableDocument.fromText("Skills.txt", "skill\tid\tdesc\nbash\t1\tx");
  assert.deepEqual(configuredAutofitColumnIndexes(doc, { "*": true }), [0, 1, 2]);
});

test("configuredAutofitColumnIndexes matches file-specific column lists", () => {
  const doc = TableDocument.fromText("Skills.txt", "skill\tid\tskilldesc\nbash\t1\tx");
  assert.deepEqual(
    configuredAutofitColumnIndexes(doc, { Skills: ["skilldesc", "srvmissile"] }),
    [0, 2]
  );
});

test("configuredAutofitColumnIndexes always includes the first column", () => {
  const doc = TableDocument.fromText("MonStats.txt", "Id\tBaseId\tNameStr\nfoo\tbar\tbaz");
  assert.deepEqual(
    configuredAutofitColumnIndexes(doc, { MonStats: ["BaseId", "NameStr"] }),
    [0, 1, 2]
  );
});
