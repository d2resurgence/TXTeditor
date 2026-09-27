// Quick Open (Resurgence): jump to an open tab or a workspace TXT by typing part of its name.
export function rankQuickOpenCandidates(candidates, query, limit = 50) {
  const q = String(query ?? "").trim().toLowerCase();
  const scored = [];
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    const base = name.replace(/\.[^.]+$/, "");
    let score;
    if (!q) score = 3;
    else if (base === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else continue;
    scored.push({ candidate, score });
  }
  scored.sort((a, b) => a.score - b.score
    || Number(b.candidate.open) - Number(a.candidate.open)
    || a.candidate.name.localeCompare(b.candidate.name));
  return scored.slice(0, limit).map((item) => item.candidate);
}

export function createQuickOpenController({
  state,
  els,
  openPaths,
  selectTab,
  focusActiveEditor = () => {}
}) {
  let results = [];

  function isOpen() {
    return !els.quickOpen.classList.contains("hidden");
  }

  function pathKey(path) {
    return String(path ?? "").replaceAll("\\", "/").toLowerCase();
  }

  // Open tabs first (they may be unsaved or have no path), then unopened workspace files.
  function candidates() {
    const list = state.docs.map((doc, index) => ({ name: doc.name, path: doc.path ?? "", open: true, index }));
    const openPathsSet = new Set(list.map((item) => pathKey(item.path)).filter(Boolean));
    for (const file of state.workspace?.files ?? []) {
      if (!/\.txt$/i.test(file.name) || openPathsSet.has(pathKey(file.path))) continue;
      list.push({ name: file.name, path: file.path, open: false, index: -1 });
    }
    return list;
  }

  function show() {
    if (isOpen()) return close();
    els.quickOpen.classList.remove("hidden");
    els.quickOpenInput.value = "";
    render("");
    els.quickOpenInput.focus();
  }

  function close({ refocus = true } = {}) {
    els.quickOpen.classList.add("hidden");
    if (refocus) focusActiveEditor();
  }

  function folderHint(path) {
    const parts = String(path ?? "").replaceAll("\\", "/").split("/");
    return parts.length > 1 ? parts.slice(-2, -1)[0] : "";
  }

  function render(query) {
    results = rankQuickOpenCandidates(candidates(), query);
    els.quickOpenResults.innerHTML = "";
    results.forEach((item, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.position = String(position);
      const name = document.createElement("span");
      name.textContent = item.name;
      const hint = document.createElement("span");
      hint.className = "quick-open-hint";
      hint.textContent = item.open ? "open" : folderHint(item.path);
      button.append(name, hint);
      button.addEventListener("click", () => choose(position));
      els.quickOpenResults.append(button);
    });
    els.quickOpenResults.querySelector("button")?.classList.add("active");
  }

  async function choose(position) {
    const item = results[position];
    if (!item) return;
    close({ refocus: false });
    if (item.open && item.index >= 0 && state.docs[item.index]?.name === item.name) {
      await selectTab(item.index);
      return;
    }
    if (item.path) await openPaths([item.path]);
    focusActiveEditor();
  }

  function moveActive(delta) {
    const buttons = [...els.quickOpenResults.querySelectorAll("button")];
    if (!buttons.length) return;
    const index = buttons.findIndex((button) => button.classList.contains("active"));
    buttons[index]?.classList.remove("active");
    const next = buttons[(index + delta + buttons.length) % buttons.length];
    next.classList.add("active");
    next.scrollIntoView?.({ block: "nearest" });
  }

  function wireEvents() {
    els.quickOpenClose.addEventListener("click", () => close());
    els.quickOpenInput.addEventListener("input", () => render(els.quickOpenInput.value));
    els.quickOpenInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const active = els.quickOpenResults.querySelector("button.active");
        if (active) choose(Number(active.dataset.position));
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
    });
    document.addEventListener("mousedown", (event) => {
      if (isOpen() && !els.quickOpen.contains(event.target)) close({ refocus: false });
    });
  }

  return { close, isOpen, show, wireEvents };
}
