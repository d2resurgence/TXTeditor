import { findInTable, normalizeSearchScope, SEARCH_SCOPE_ALL } from "../../core/search.js";
import {
  searchScrollOptionsForScope,
  searchShouldIncludeStart,
  searchStatusText,
  searchStateAfterFind,
  searchStateAfterInput,
  searchTargetForResult,
  shouldCloseSearchKey,
  shouldSubmitSearchKey
} from "../search-policy.js";

export function createSearchController({ state, els, grid, activeDoc, updateActiveProblemHighlight, saveSelectionState = () => {} }) {
  function resetSearchPanelUi() {
    const scopeFieldset = els.searchPanel.querySelector(".search-scope");
    if (scopeFieldset) scopeFieldset.classList.remove("hidden");
    if (els.searchTitle) els.searchTitle.textContent = "Find";
    els.searchInput.placeholder = "Search in current table";
  }

  function showSearch({ firstColumnOnly = false } = {}) {
    state.search.firstColumnOnly = firstColumnOnly;
    state.search.lastQuery = "";
    const scopeFieldset = els.searchPanel.querySelector(".search-scope");
    if (scopeFieldset) scopeFieldset.classList.toggle("hidden", firstColumnOnly);
    if (firstColumnOnly) {
      if (els.searchTitle) els.searchTitle.textContent = "Find in First Column";
      els.searchInput.placeholder = "Search in first column";
    } else {
      resetSearchPanelUi();
    }
    els.searchPanel.classList.remove("hidden");
    els.searchInput.focus();
    els.searchInput.select();
  }

  function closeSearch() {
    state.search.firstColumnOnly = false;
    resetSearchPanelUi();
    els.searchPanel.classList.add("hidden");
    els.host.focus();
  }

  function selectedSearchScope() {
    return normalizeSearchScope(
      els.searchPanel.querySelector("input[name='searchScope']:checked")?.value
    );
  }

  function findNext() {
    const query = els.searchInput.value;
    const firstColumnOnly = Boolean(state.search.firstColumnOnly);
    const scope = firstColumnOnly ? SEARCH_SCOPE_ALL : selectedSearchScope();
    const includeStart = searchShouldIncludeStart(
      query,
      scope,
      state.search.lastQuery,
      state.search.lastScope,
      firstColumnOnly,
      state.search.firstColumnOnly
    );
    const focus = state.selection.focus;
    const findOptions = { includeStart, scope };
    if (firstColumnOnly) findOptions.onlyColumn = 0;
    const found = findInTable(activeDoc(), query, focus, findOptions);
    if (!found) {
      els.searchStatus.textContent = "No results";
      return;
    }
    const target = firstColumnOnly
      ? { row: found.row, column: found.column }
      : searchTargetForResult(scope, found, focus);
    Object.assign(state.search, searchStateAfterFind(query, scope, firstColumnOnly));
    state.selection.set(target.row, target.column);
    saveSelectionState();
    grid.scrollCellIntoView(target.row, target.column, searchScrollOptionsForScope(scope));
    grid.draw();
    updateActiveProblemHighlight();
    els.searchStatus.textContent = firstColumnOnly
      ? `R${target.row + 1}:C${target.column + 1}`
      : searchStatusText(scope, found, target);
  }

  function wireEvents() {
    els.searchInput.addEventListener("keydown", (event) => {
      if (shouldSubmitSearchKey(event.key)) {
        event.preventDefault();
        findNext();
      }
      if (shouldCloseSearchKey(event.key)) {
        event.preventDefault();
        closeSearch();
      }
    });
    els.searchInput.addEventListener("input", () => {
      Object.assign(state.search, searchStateAfterInput(state.search));
    });
    els.searchPanel.querySelectorAll("input[name='searchScope']").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (!shouldSubmitSearchKey(event.key)) return;
        event.preventDefault();
        findNext();
      });
      input.addEventListener("change", () => {
        Object.assign(state.search, searchStateAfterInput(state.search));
      });
    });
    els.searchPanel.addEventListener("click", (event) => {
      if (event.target === els.searchPanel || event.target.closest("[data-search-close]")) closeSearch();
    });
  }

  return {
    closeSearch,
    findNext,
    showSearch,
    wireEvents
  };
}
