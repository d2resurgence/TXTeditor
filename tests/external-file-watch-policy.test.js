import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import {
  acknowledgeExternalChange,
  externalChangeMessage,
  isExternalFileChange,
  isSaveOverExternalChange,
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

test("saving over a newer disk version warns even after the banner was dismissed", () => {
  const doc = { name: "Skills.txt", path: "C:/mod/Skills.txt" };
  setDiskWatchBaseline(doc, 1000);
  assert.equal(isSaveOverExternalChange(doc, 1000), false, "unchanged file saves silently");
  assert.equal(isSaveOverExternalChange(doc, 2000), true, "newer file on disk warns");

  // Dismiss advances the banner baseline only; the editor still holds the older content.
  acknowledgeExternalChange(doc, 2000);
  assert.equal(shouldNotifyExternalChange(doc, 2000), false);
  assert.equal(isSaveOverExternalChange(doc, 2000), true);

  // A save or reload re-syncs the editor with the disk.
  setDiskWatchBaseline(doc, 3000);
  assert.equal(isSaveOverExternalChange(doc, 3000), false);
});
