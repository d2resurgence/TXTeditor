import assert from "node:assert/strict";
import test from "node:test";
import { rankQuickOpenCandidates } from "../src/ui/controllers/quick-open-controller.js";

const files = [
  { name: "Missiles.txt", open: false },
  { name: "MissCalc.txt", open: false },
  { name: "Skills.txt", open: true },
  { name: "SkillDesc.txt", open: false },
  { name: "MonStats.txt", open: false }
];

test("quick open ranks exact names, then prefixes, then substrings", () => {
  assert.deepEqual(rankQuickOpenCandidates(files, "skills").map((file) => file.name), ["Skills.txt"]);
  assert.deepEqual(rankQuickOpenCandidates(files, "miss").map((file) => file.name), ["MissCalc.txt", "Missiles.txt"]);
  assert.deepEqual(rankQuickOpenCandidates(files, "desc").map((file) => file.name), ["SkillDesc.txt"]);
  assert.deepEqual(rankQuickOpenCandidates(files, "zzz"), []);
});

test("quick open lists open tabs first when there is no query", () => {
  assert.equal(rankQuickOpenCandidates(files, "")[0].name, "Skills.txt");
  assert.equal(rankQuickOpenCandidates(files, "", 2).length, 2);
});
