import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import {
  deriveMissileNewName,
  detectNameTransform,
  duplicateNameUnchanged,
  findUnchangedDuplicateEntries,
  resolveMissileDuplicate,
  resolveSkillDuplicate
} from "../src/core/skill-duplicate.js";

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

test("deriveMissileNewName keeps the original name when rename logic cannot infer a distinct name", () => {
  const transform = detectNameTransform("Tornado", "MyCustomTornado");
  assert.equal(
    deriveMissileNewName("unrelatedbolt", transform, { oldSkillName: "Tornado", newSkillName: "MyCustomTornado" }),
    "unrelatedbolt"
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
