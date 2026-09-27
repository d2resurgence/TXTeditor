import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import { isStringKeyCol } from "../src/core/string-goto-policy.js";
import {
  PROC_SKILL_ID_LIMIT,
  allocateId,
  deriveMissileNewName,
  detectNameTransform,
  duplicateNameUnchanged,
  findUnchangedDuplicateEntries,
  resolveMissileDuplicate,
  resolveSkillDuplicate,
  rowForId
} from "../src/core/skill-duplicate.js";

function skillsDoc() {
  return TableDocument.fromText("Skills.txt", [
    "skill\tId\tsrvmissile\tcltmissile",
    "Fire Bolt\t0\tfirebolt\t",
    "Blade Shield\t1\tblade shield attachment\t",
    "Mon Thing\t7\t\t"
  ].join("\n"));
}

function missilesDoc() {
  return TableDocument.fromText("Missiles.txt", [
    "Missile\tId\tExplosionMissile\tCltSubMissile1",
    "firebolt\t0\tfireexplode\t",
    "blade shield attachment\t1\t\tblade shield missile",
    "blade shield missile\t2\t\t",
    "fireexplode\t3\t\t"
  ].join("\n"));
}

test("detectNameTransform recognizes suffix renames", () => {
  assert.deepEqual(detectNameTransform("Tornado", "Tornado2"), { kind: "suffix", affix: "2" });
  assert.deepEqual(detectNameTransform("Frozen Orb", "Frozen Orb2"), { kind: "suffix", affix: "2" });
  assert.deepEqual(detectNameTransform("RogueMissile", "RogueMissile2"), { kind: "suffix", affix: "2" });
});

test("deriveMissileNewName replaces skill stem prefixes for unrelated skill renames", () => {
  const transform = detectNameTransform("Volcano", "Pompeii");
  assert.equal(
    deriveMissileNewName("volcano", transform, { oldSkillName: "Volcano", newSkillName: "Pompeii" }),
    "pompeii"
  );
  assert.equal(
    deriveMissileNewName("volcano small fire", transform, { oldSkillName: "Volcano", newSkillName: "Pompeii" }),
    "pompeii small fire"
  );
  assert.equal(
    deriveMissileNewName("volcano explosion", transform, { oldSkillName: "Volcano", newSkillName: "Pompeii" }),
    "pompeii explosion"
  );
  assert.equal(
    deriveMissileNewName("volcano overlay fire", transform, { oldSkillName: "Volcano", newSkillName: "Pompeii" }),
    "pompeii overlay fire"
  );
});

test("deriveMissileNewName replaces compressed skill stems inside compound missile names", () => {
  const transform = detectNameTransform("Frozen Orb", "Frost Orb");
  assert.equal(
    deriveMissileNewName("frozenorbbolt", transform, { oldSkillName: "Frozen Orb", newSkillName: "Frost Orb" }),
    "frostorbbolt"
  );
  assert.equal(
    deriveMissileNewName("frozenorb overlay", transform, { oldSkillName: "Frozen Orb", newSkillName: "Frost Orb" }),
    "frostorb overlay"
  );
});

test("deriveMissileNewName applies skill stem replacement for related missiles", () => {
  const transform = detectNameTransform("Tornado", "Tornado2");
  assert.equal(
    deriveMissileNewName("tornado", transform, { oldSkillName: "Tornado", newSkillName: "Tornado2" }),
    "tornado2"
  );
  assert.equal(
    deriveMissileNewName("tornadofragment", transform, { oldSkillName: "Tornado", newSkillName: "Tornado2" }),
    "tornado2fragment"
  );

  const frozenTransform = detectNameTransform("Frozen Orb", "Frozen Orb2");
  assert.equal(
    deriveMissileNewName("frozenorb", frozenTransform, { oldSkillName: "Frozen Orb", newSkillName: "Frozen Orb2" }),
    "frozenorb2"
  );
  assert.equal(
    deriveMissileNewName("frozenorbbolt", frozenTransform, { oldSkillName: "Frozen Orb", newSkillName: "Frozen Orb2" }),
    "frozenorb2bolt"
  );
});

test("deriveMissileNewName uses the new root name for the source missile", () => {
  const transform = detectNameTransform("RogueMissile", "RogueMissile2");
  assert.equal(
    deriveMissileNewName("RogueMissile", transform, {
      sourceMissileName: "RogueMissile",
      newMissileName: "RogueMissile2",
      isSourceMissile: true
    }),
    "RogueMissile2"
  );
});

test("deriveMissileNewName still renames missiles that share no stem with the skill", () => {
  const transform = detectNameTransform("Tornado", "MyCustomTornado");
  assert.equal(
    deriveMissileNewName("unrelatedbolt", transform, { oldSkillName: "Tornado", newSkillName: "MyCustomTornado" }),
    "mycustomunrelatedbolt"
  );
  // No shared stem at all: prefix with the new root so Apply is never blocked.
  const unrelated = detectNameTransform("Blade Shield", "Molten Armor");
  assert.equal(
    deriveMissileNewName("poisonpuff", unrelated, { oldSkillName: "Blade Shield", newSkillName: "Molten Armor" }),
    "moltenarmorpoisonpuff"
  );
  assert.equal(
    deriveMissileNewName("Poison Puff", unrelated, { oldSkillName: "Blade Shield", newSkillName: "Molten Armor" }),
    "Molten Armor Poison Puff"
  );
});

test("deriveMissileNewName rewrites skill stems that keep their spaces", () => {
  const transform = detectNameTransform("Blade Shield", "Molten Armor");
  assert.equal(
    deriveMissileNewName("blade shield attachment", transform, { oldSkillName: "Blade Shield", newSkillName: "Molten Armor" }),
    "molten armor attachment"
  );
  assert.equal(
    deriveMissileNewName("bladeshieldmissile", transform, { oldSkillName: "Blade Shield", newSkillName: "Molten Armor" }),
    "moltenarmormissile"
  );
});

test("findUnchangedDuplicateEntries lists rows that still use the source name", () => {
  const changeset = {
    skill: { originalName: "Tornado", newName: "Tornado2" },
    missiles: [
      { originalName: "tornado", newName: "tornado2" },
      { originalName: "ember", newName: "ember" }
    ]
  };
  assert.equal(duplicateNameUnchanged("ember", "ember"), true);
  assert.deepEqual(findUnchangedDuplicateEntries(changeset), [
    { kind: "missile", entry: changeset.missiles[1] }
  ]);
});

test("resolveMissileDuplicate names the root missile after the user's new name", () => {
  const missilesDoc = TableDocument.fromText(
    "Missile\tId\tsubmissile1",
    "Missile\tId\tsubmissile1\nRogueMissile\t100\troguearrow\nroguearrow\t101\t"
  );
  const result = resolveMissileDuplicate(missilesDoc, "RogueMissile", "RogueMissile2");
  assert.ifError(result.error);
  const root = result.missiles.find((entry) => entry.originalName === "RogueMissile");
  const child = result.missiles.find((entry) => entry.originalName === "roguearrow");
  assert.equal(root.newName, "RogueMissile2");
  assert.equal(child.newName, "roguearrow2");
});

test("resolveMissileDuplicate applies source missile stem prefix to related missiles", () => {
  const missilesDoc = TableDocument.fromText(
    "Missile\tId\tsubmissile1\tsubmissile2",
    [
      "Missile\tId\tsubmissile1\tsubmissile2",
      "frozenorb\t100\tfrozenorbbolt\tfrozenorbnova",
      "frozenorbbolt\t101\tfrozenorbexplode\t",
      "frozenorbexplode\t102\t\t",
      "frozenorbnova\t103\t\t"
    ].join("\n")
  );
  const result = resolveMissileDuplicate(missilesDoc, "frozenorb", "phantomarrow1");
  assert.ifError(result.error);
  assert.equal(result.missiles.find((entry) => entry.originalName === "frozenorb").newName, "phantomarrow1");
  assert.equal(result.missiles.find((entry) => entry.originalName === "frozenorbbolt").newName, "phantomarrow1bolt");
  assert.equal(result.missiles.find((entry) => entry.originalName === "frozenorbexplode").newName, "phantomarrow1explode");
  assert.equal(result.missiles.find((entry) => entry.originalName === "frozenorbnova").newName, "phantomarrow1nova");
});

test("deriveMissileNewName applies source missile stem prefix for unrelated root renames", () => {
  const transform = detectNameTransform("frozenorb", "phantomarrow1");
  assert.equal(
    deriveMissileNewName("frozenorbexplode", transform, {
      sourceMissileName: "frozenorb",
      newMissileName: "phantomarrow1"
    }),
    "phantomarrow1explode"
  );
});

test("resolveSkillDuplicate applies stem replacement when skill and missile share a name", () => {
  const skillsDoc = TableDocument.fromText(
    "skill\tId\tsrvmissile",
    "skill\tId\tsrvmissile\nRogueMissile\t50\tRogueMissile"
  );
  const missilesDoc = TableDocument.fromText(
    "Missile\tId",
    "Missile\tId\nRogueMissile\t100\nroguearrow\t101"
  );
  const result = resolveSkillDuplicate(skillsDoc, missilesDoc, "RogueMissile", "RogueMissile2");
  assert.ifError(result.error);
  const rogueMissile = result.missiles.find((entry) => entry.originalName === "RogueMissile");
  assert.equal(rogueMissile.newName, "RogueMissile2");
});

test("allocateId appends past the highest id and keeps proc skills in range", () => {
  assert.equal(allocateId([0, 1, 2]), 3);
  assert.equal(allocateId([], { claimed: [5] }), 6);
  // A proc skill cannot use an id above the 10-bit limit, so it fills a gap below it.
  const full = Array.from({ length: PROC_SKILL_ID_LIMIT + 2 }, (_, index) => index).filter((id) => id !== 44);
  assert.equal(allocateId(full), PROC_SKILL_ID_LIMIT + 2);
  assert.equal(allocateId(full, { isProc: true }), 44);
  assert.equal(allocateId(Array.from({ length: PROC_SKILL_ID_LIMIT + 2 }, (_, index) => index), { isProc: true }), null);
});

test("resolveSkillDuplicate appends ids after the last row and orders missiles by source row", () => {
  const result = resolveSkillDuplicate(skillsDoc(), missilesDoc(), "Blade Shield", "Molten Armor");
  assert.equal(result.skill.targetId, 8, "next id after the highest skill id");
  assert.deepEqual(result.missiles.map((entry) => entry.originalName), [
    "blade shield attachment",
    "blade shield missile"
  ]);
  assert.deepEqual(result.missiles.map((entry) => entry.newName), [
    "molten armor attachment",
    "molten armor missile"
  ]);
  assert.deepEqual(result.missiles.map((entry) => entry.targetId), [4, 5]);
});

test("resolveSkillDuplicate reports excluded missiles instead of dropping them", () => {
  const result = resolveSkillDuplicate(skillsDoc(), missilesDoc(), "Fire Bolt", "Ice Bolt");
  assert.deepEqual(result.missiles.map((entry) => entry.originalName), ["firebolt"]);
  assert.deepEqual(result.excludedMissiles.map((entry) => entry.originalName), ["fireexplode"]);
  assert.equal(result.excludedMissiles[0].excluded, true);
  assert.equal(result.excludedMissiles[0].targetId, null);

  // Forcing it in (the panel's checkbox) duplicates it like any other missile.
  const forced = resolveSkillDuplicate(skillsDoc(), missilesDoc(), "Fire Bolt", "Ice Bolt", new Set());
  assert.deepEqual(forced.missiles.map((entry) => entry.originalName), ["firebolt", "fireexplode"]);
  assert.deepEqual(forced.excludedMissiles, []);
});

test("resolveSkillDuplicate keeps a proc skill id inside the proc range", () => {
  const doc = TableDocument.fromText("Skills.txt", [
    "skill\tId\tsrvmissile",
    "Fire Bolt\t0\tfirebolt",
    "Far Skill\t2000\t"
  ].join("\n"));
  assert.equal(resolveSkillDuplicate(doc, missilesDoc(), "Fire Bolt", "Ice Bolt").skill.targetId, 2001);
  assert.equal(resolveSkillDuplicate(doc, missilesDoc(), "Fire Bolt", "Ice Bolt", null, { isProc: true }).skill.targetId, 1);
});

test("rowForId maps a target id back to its row and reports unknown ids", () => {
  const doc = missilesDoc();
  assert.equal(rowForId(doc, 2), 3);
  assert.equal(rowForId(doc, "3"), 4);
  assert.equal(rowForId(doc, 99), -1);
  assert.equal(rowForId(doc, null), -1);
});

test("string GoToDef covers the display-string columns audited against Resurgence data", () => {
  for (const [column, file] of [
    ["descstr2", "ItemStatCost.txt"], ["dgrpstrpos", "ItemStatCost.txt"], ["dgrpstrneg", "ItemStatCost.txt"],
    ["DescStr", "MonStats.txt"], ["StrAllSkills", "CharStats.txt"], ["StrSkillTab2", "CharStats.txt"],
    ["NameFirst", "Hireling.txt"], ["NameLast", "Hireling.txt"], ["Name", "SuperUniques.txt"],
    ["name", "Sets.txt"], ["name", "PetType.txt"], ["Name", "Objects.txt"], ["Name", "Books.txt"],
    ["Name", "UniquePrefix.txt"], ["NameStr", "MonStats.txt"]
  ]) {
    assert.equal(isStringKeyCol(column, file), true, `${file}:${column} should be a string key column`);
  }
  // Item codes resolve through vector-lsp instead, so they stay out of the string fallback.
  for (const [column, file] of [["code", "Armor.txt"], ["Rune1", "Runes.txt"], ["item1", "CharStats.txt"]]) {
    assert.equal(isStringKeyCol(column, file), false, `${file}:${column} should not be a string key column`);
  }
});

test("resolveSkillDuplicate reuses unused placeholder rows on either side of the proc limit", () => {
  const doc = TableDocument.fromText("Skills.txt", [
    "skill\tId\tsrvmissile",
    "Fire Bolt\t0\tfirebolt",
    "unused1\t1\t",
    "unused1023\t1023\t",
    "unused1024\t1024\t",
    "unused1025\t1025\t"
  ].join("\n"));
  // Non-proc skills skip the proc range (and Id 1023) and overwrite the first placeholder above it.
  assert.equal(resolveSkillDuplicate(doc, missilesDoc(), "Fire Bolt", "Ice Bolt").skill.targetId, 1024);
  // Proc skills take the first placeholder below the limit.
  assert.equal(resolveSkillDuplicate(doc, missilesDoc(), "Fire Bolt", "Ice Bolt", null, { isProc: true }).skill.targetId, 1);
  assert.equal(rowForId(doc, 1024), 4);
});
