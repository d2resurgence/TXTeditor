export function contextMenuActiveGroupId(group) {
  return group?.dataset?.menuGroup ?? "";
}

export function contextMenuGroupIsActive(candidate, activeGroup) {
  return candidate === activeGroup;
}

export function contextMenuHiddenState() {
  // contextHit is dropped with the menu: commands started from the keyboard or the
  // palette must act on the selection, not on the last cell that was right-clicked.
  return { contextMenuActiveGroup: "", contextMenuOpen: false, contextHit: null };
}

export function contextMenuOpenTransition(open) {
  const contextMenuOpen = Boolean(open);
  return {
    contextMenuOpen,
    hoverSuspended: contextMenuOpen,
    clearVisibleHoverReason: contextMenuOpen ? "context-menu-open" : null
  };
}

export function visibleHoverClearEvent({ reason = "hover-cleared", inFlight = 0 } = {}) {
  return { reason, visibleClear: true, inFlight };
}

export function visibleHoverClearKeepsPendingRequests() {
  return true;
}
