import { normalizePath } from "./lint-paths.js";

// Upstream reopens the saved workspace only after an in-session reload. With config
// `restoreWorkspace` set, a fresh launch also reopens it, falling back to `lastWorkspacePath`.
export function restoresWorkspaceOnStartup({ isReload, config } = {}) {
  return Boolean(isReload) || config?.restoreWorkspace === true;
}

export function startupWorkspaceCandidates({ isReload, storedPath, config } = {}) {
  if (!restoresWorkspaceOnStartup({ isReload, config })) return [];
  const paths = isReload ? [storedPath] : [storedPath, config?.lastWorkspacePath];
  const seen = new Set();
  return paths
    .map((path) => (typeof path === "string" ? path.trim() : ""))
    .filter((path) => {
      if (!path) return false;
      const key = normalizePath(path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
