export function createColumnSearchController({
  state,
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  saveSelectionState = () => {}
}) {
  function isOpen() {
    return !els.columnSearch.classList.contains("hidden");
  }

  function showColumnSearch() {
    if (!hasOpenDocument()) return;
    if (isOpen()) {
      closeColumnSearch();
      return;
    }
    const btn = document.querySelector('[data-command="show-column-search"]');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      els.columnSearch.style.left = `${rect.left}px`;
      els.columnSearch.style.top = `${rect.bottom + 4}px`;
    }
    els.columnSearch.classList.remove("hidden");
    els.columnSearchInput.value = "";
    renderColumnSearchResults("");
    els.columnSearchInput.focus();
  }

  function closeColumnSearch() {
    els.columnSearch.classList.add("hidden");
    els.host.focus();
  }

  function renderColumnSearchResults(query) {
    const doc = activeDoc();
    const q = query.toLowerCase();
    const results = [];
    for (let col = 0; col < doc.columnCount; col++) {
      const name = doc.getCell(0, col) ?? "";
      if (!q || name.toLowerCase().includes(q)) results.push({ col, name });
      if (results.length >= 50) break;
    }
    els.columnSearchResults.innerHTML = "";
    for (const { col, name } of results) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = name || `Column ${col + 1}`;
      btn.dataset.col = String(col);
      btn.addEventListener("click", () => jumpToColumn(col));
      els.columnSearchResults.append(btn);
    }
    els.columnSearchResults.querySelector("button")?.classList.add("active");
  }

  function jumpToColumn(col) {
    closeColumnSearch();
    const row = state.selection.focus.row;
    state.selection.set(row, col);
    saveSelectionState();
    grid.scrollCellToCenter(row, col);
    grid.draw();
  }

  function wireEvents() {
    els.columnSearchClose.addEventListener("click", closeColumnSearch);
    els.columnSearchInput.addEventListener("input", () => renderColumnSearchResults(els.columnSearchInput.value));
    els.columnSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeColumnSearch();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const active = els.columnSearchResults.querySelector("button.active");
        if (active) jumpToColumn(Number(active.dataset.col));
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = [...els.columnSearchResults.querySelectorAll("button")];
      const index = buttons.findIndex((button) => button.classList.contains("active"));
      buttons[index]?.classList.remove("active");
      const next = event.key === "ArrowDown"
        ? buttons[(index + 1) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
      next?.classList.add("active");
    });
    document.addEventListener("mousedown", (event) => {
      if (!isOpen()) return;
      if (els.columnSearch.contains(event.target)) return;
      if (event.target.closest('[data-command="show-column-search"]')) return;
      closeColumnSearch();
    });
  }

  return {
    closeColumnSearch,
    isOpen,
    jumpToColumn,
    showColumnSearch,
    wireEvents
  };
}
