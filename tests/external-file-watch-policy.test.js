import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import {
  acknowledgeExternalChange,
  externalChangeMessage,
  isExternalFileChange,
  setDiskWatchBaseline,
  shouldNotifyExternalChange
} from "../src/ui/external-file-watch-policy.js";

test("isExternalFileChange compares disk mtimes", () => {
  assert.equal(isExternalFileChange(100, 100), false);
  assert.equal(isExternalFileChange(100, 101), true);
  assert.equal(isExternalFileChange(null, 101), false);
});

test("shouldNotifyExternalChange ignores the baseline and repeats after acknowledgement", () => {
  const doc = TableDocument.fromText("skills.txt", "a\tb", { path: "D:\\mods\\skills.txt" });
  setDiskWatchBaseline(doc, 100);
  assert.equal(shouldNotifyExternalChange(doc, 100), false);
  assert.equal(shouldNotifyExternalChange(doc, 150), true);
  acknowledgeExternalChange(doc, 150);
  assert.equal(shouldNotifyExternalChange(doc, 150), false);
  assert.equal(shouldNotifyExternalChange(doc, 200), true);
});

test("externalChangeMessage names the affected file", () => {
  const doc = TableDocument.fromText("skills.txt", "a\tb", { path: "skills.txt" });
  assert.equal(externalChangeMessage(doc), "skills.txt changed on disk.");
});
