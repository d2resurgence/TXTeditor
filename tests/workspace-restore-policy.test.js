import assert from "node:assert/strict";
import test from "node:test";
import { restoresWorkspaceOnStartup, startupWorkspaceCandidates } from "../src/core/workspace-restore-policy.js";

test("an in-session reload restores only the remembered folder, whatever the config says", () => {
  const config = { restoreWorkspace: false, lastWorkspacePath: "E:\\Mod\\data" };
  assert.equal(restoresWorkspaceOnStartup({ isReload: true, config }), true);
  assert.deepEqual(startupWorkspaceCandidates({ isReload: true, storedPath: "E:\\Saved", config }), ["E:\\Saved"]);
});

test("a fresh launch restores nothing unless restoreWorkspace is exactly true", () => {
  for (const config of [{}, { restoreWorkspace: false }, { restoreWorkspace: "true" }, null]) {
    assert.equal(restoresWorkspaceOnStartup({ isReload: false, config }), false);
    assert.deepEqual(startupWorkspaceCandidates({ isReload: false, storedPath: "E:\\Saved", config }), []);
  }
});

test("a fresh launch tries the remembered folder first, then lastWorkspacePath", () => {
  const config = { restoreWorkspace: true, lastWorkspacePath: "E:\\Mod\\data" };
  assert.deepEqual(startupWorkspaceCandidates({ isReload: false, storedPath: "E:\\Saved", config }), ["E:\\Saved", "E:\\Mod\\data"]);
  assert.deepEqual(startupWorkspaceCandidates({ isReload: false, storedPath: "", config }), ["E:\\Mod\\data"]);
  assert.deepEqual(startupWorkspaceCandidates({ isReload: false, storedPath: null, config: { restoreWorkspace: true } }), []);
});

test("the same folder spelled with other slashes is tried once", () => {
  const config = { restoreWorkspace: true, lastWorkspacePath: "E:/Mod/data" };
  assert.deepEqual(startupWorkspaceCandidates({ isReload: false, storedPath: " E:\\Mod\\data ", config }), ["E:\\Mod\\data"]);
});
