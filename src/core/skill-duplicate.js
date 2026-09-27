const SKILL_MISSILE_COLS = [
  'srvmissile', 'srvmissilea', 'srvmissileb', 'srvmissilec',
  'cltmissile', 'cltmissilea', 'cltmissileb', 'cltmissilec',
];

const MISSILE_SUB_COLS = [
  'explosionmissile',
  'submissile1', 'submissile2', 'submissile3',
  'hitsubmissile1', 'hitsubmissile2', 'hitsubmissile3', 'hitsubmissile4',
  'cltsubmissile1', 'cltsubmissile2', 'cltsubmissile3',
  'clthitsubmissile1', 'clthitsubmissile2', 'clthitsubmissile3', 'clthitsubmissile4',
];

export const EXCLUDE_DEFAULT = new Set([
  'explodingarrowexp', 'fireexplode', 'iceexplode',
  'blizzardexplode1', 'blizzardexplode3',
  'fireexplosion2', 'firemedium', 'firesmall',
  'freezingarrowexp1', 'freezingarrowexp2',
  'lightninghit', 'poisonpuff', 'whitelightmissile',
]);

function makeColIndex(doc) {
  const map = new Map();
  for (let c = 0; c < doc.columnCount; c++) map.set(doc.getCell(0, c).toLowerCase(), c);
  return map;
}

function makeRowIndex(doc, nameColIdx) {
  const map = new Map();
  for (let r = 1; r < doc.rowCount; r++) {
    const name = doc.getCell(r, nameColIdx).trim().toLowerCase();
    if (name) map.set(name, r);
  }
  return map;
}

function getRowValues(doc, rowNum) {
  return Array.from({ length: doc.columnCount }, (_, c) => doc.getCell(rowNum, c));
}

function collectMissileTree(rootNames, missileByName, missilesDoc, subColIdxs, exclude) {
  const visited = new Set();
  const skipped = new Set();
  const queue = rootNames.map(n => n.toLowerCase()).filter(Boolean);
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const row = missileByName.get(name);
    if (row == null) continue;
    // Excluded missiles are reported so the panel can offer to force-duplicate them,
    // but their own sub-missiles are not pulled in unless the user includes them.
    if (exclude.has(name)) { skipped.add(name); continue; }
    visited.add(name);
    for (const idx of subColIdxs) {
      if (idx < 0) continue;
      const sub = missilesDoc.getCell(row, idx).trim().toLowerCase();
      if (sub && !visited.has(sub)) queue.push(sub);
    }
  }
  return { included: visited, excluded: skipped };
}

// Duplicated rows keep the order they appear in the source file; references are
// remapped by name, so write order does not matter.
function bySourceRow(entries) {
  return [...entries].sort((a, b) => a.sourceRow - b.sourceRow);
}

function assignIds(entries, nextId) {
  for (const entry of entries) entry.targetId = nextId();
  return entries;
}

// Item procs store a skill id in 10 bits, so a skill used by a proc must stay below 1023.
export const PROC_SKILL_ID_LIMIT = 1022;

export function collectUsedIds(doc, idColIdx) {
  const used = new Set();
  if (idColIdx < 0) return used;
  for (let r = 1; r < doc.rowCount; r++) {
    const value = parseInt(doc.getCell(r, idColIdx), 10);
    if (!Number.isNaN(value)) used.add(value);
  }
  return used;
}

export function rowForId(doc, id) {
  const idColIdx = makeColIndex(doc).get('id') ?? -1;
  if (idColIdx < 0 || id == null || id === '') return -1;
  const wanted = parseInt(id, 10);
  if (Number.isNaN(wanted)) return -1;
  for (let r = 1; r < doc.rowCount; r++) {
    if (parseInt(doc.getCell(r, idColIdx), 10) === wanted) return r;
  }
  return -1;
}

/**
 * Pick the id a duplicated row should take.
 * Default is "append": one past the highest id in the file. A proc skill must stay
 * within the 10-bit proc range, so it falls back to the lowest free id below the limit.
 */
export function allocateId(used, { isProc = false, claimed = null } = {}) {
  const taken = new Set(used);
  for (const id of claimed ?? []) taken.add(id);
  let next = 0;
  for (const id of taken) if (id >= next) next = id + 1;
  if (!isProc || next <= PROC_SKILL_ID_LIMIT) return next;
  for (let id = 0; id <= PROC_SKILL_ID_LIMIT; id++) if (!taken.has(id)) return id;
  return null;
}

// Placeholder rows ("unused491", ...) reserve an Id; reusing them keeps a padded table
// at its fixed size. Proc skills take a placeholder below the proc limit, everything
// else one above 1023 so the proc range is left free. Without a placeholder in range,
// fall back to allocateId (append, or the lowest free proc Id).
export function isPlaceholderName(name) {
  return /^unused/i.test(String(name ?? '').trim());
}

function placeholderSlots(doc, idColIdx, nameColIdx) {
  const slots = [];
  if (idColIdx < 0 || nameColIdx < 0) return slots;
  for (let r = 1; r < doc.rowCount; r++) {
    if (!isPlaceholderName(doc.getCell(r, nameColIdx))) continue;
    const id = parseInt(doc.getCell(r, idColIdx), 10);
    if (!Number.isNaN(id)) slots.push(id);
  }
  return slots.sort((a, b) => a - b);
}

function makeIdSuggester(doc, idColIdx, { isProc = false, nameColIdx = -1, skillRanges = false } = {}) {
  const used = collectUsedIds(doc, idColIdx);
  const slots = placeholderSlots(doc, idColIdx, nameColIdx);
  const inRange = (id) => !skillRanges || (isProc ? id <= PROC_SKILL_ID_LIMIT : id > PROC_SKILL_ID_LIMIT + 1);
  const claimed = new Set();
  return function next() {
    const slot = slots.find((id) => !claimed.has(id) && inRange(id));
    const id = slot ?? allocateId(used, { isProc, claimed });
    if (id != null) claimed.add(id);
    return id;
  };
}

/**
 * Detect how a skill/missile name was transformed (suffix, prefix, or stem suffix).
 */
export function detectNameTransform(oldName, newName) {
  const o = oldName.trim();
  const n = newName.trim();
  if (!o || !n) return { kind: 'fallback-space', affix: n ? `${n} ` : '' };
  const ol = o.toLowerCase();
  const nl = n.toLowerCase();
  if (ol === nl) return { kind: 'same' };
  if (nl.startsWith(ol)) return { kind: 'suffix', affix: n.slice(o.length) };
  if (nl.endsWith(ol)) return { kind: 'prefix', affix: n.slice(0, n.length - o.length) };
  const stemOld = ol.replace(/\s+/g, '');
  const stemNew = nl.replace(/\s+/g, '');
  if (stemNew.startsWith(stemOld)) {
    return { kind: 'stem-suffix', stemOld, stemNew, stemAffix: stemNew.slice(stemOld.length) };
  }
  return { kind: 'fallback-space', affix: `${n} ` };
}

/**
 * Derive a duplicated missile name from the source name and the user's rename.
 */
function applySkillStemPrefixRename(orig, skillStem, newSkillStemText, newSpacedText = '') {
  if (!skillStem) return null;
  const trimmed = orig.trim();
  // Consume as many characters of the missile name as the (space-stripped) skill stem
  // covers, so "blade shield attachment" matches the stem "bladeshield" too.
  let consumed = 0;
  let matched = 0;
  let sawSpace = false;
  while (consumed < trimmed.length && matched < skillStem.length) {
    const ch = trimmed[consumed];
    if (/\s/.test(ch)) { sawSpace = true; consumed++; continue; }
    if (ch.toLowerCase() !== skillStem[matched]) return null;
    consumed++;
    matched++;
  }
  if (matched < skillStem.length) return null;
  const replacementText = sawSpace && newSpacedText ? newSpacedText : newSkillStemText;
  const replacement = trimmed === trimmed.toLowerCase()
    ? replacementText.toLowerCase()
    : replacementText;
  return replacement + trimmed.slice(consumed);
}

export function deriveMissileNewName(origName, transform, context = {}) {
  const orig = origName.trim();
  if (!orig) return orig;
  const ol = orig.toLowerCase();
  const {
    oldSkillName = '',
    newSkillName = '',
    sourceMissileName = '',
    newMissileName = '',
    isSourceMissile = false
  } = context;

  if (isSourceMissile && ol === sourceMissileName.trim().toLowerCase()) {
    return newMissileName.trim() || orig;
  }

  const skillStem = oldSkillName.trim().replace(/\s+/g, '').toLowerCase();
  const newSkillStemText = newSkillName.trim().replace(/\s+/g, '');
  const formatStemReplacement = (replacement) => (
    orig === orig.toLowerCase() ? replacement.toLowerCase() : replacement
  );
  if (skillStem && ol === skillStem) return formatStemReplacement(newSkillStemText);
  if (skillStem && ol === oldSkillName.trim().toLowerCase()) {
    return formatStemReplacement(newSkillStemText);
  }
  if (oldSkillName.trim()) {
    const stemPrefixed = applySkillStemPrefixRename(orig, skillStem, newSkillStemText, newSkillName.trim());
    if (stemPrefixed != null) return stemPrefixed;
  }

  const missileStem = sourceMissileName.trim().replace(/\s+/g, '').toLowerCase();
  const newMissileStemText = newMissileName.trim().replace(/\s+/g, '');
  if (sourceMissileName.trim()) {
    if (missileStem && ol === missileStem) return formatStemReplacement(newMissileStemText);
    const stemPrefixed = applySkillStemPrefixRename(orig, missileStem, newMissileStemText, newMissileName.trim());
    if (stemPrefixed != null) return stemPrefixed;
  }

  switch (transform.kind) {
    case 'same':
      return orig;
    case 'suffix': {
      if (ol === oldSkillName.trim().toLowerCase()) return newSkillName.trim();
      return orig + transform.affix;
    }
    case 'prefix':
      return prefixWithNewRoot(orig, transform.affix);
    case 'stem-suffix':
      if (ol.startsWith(transform.stemOld)) {
        return transform.stemNew + orig.slice(transform.stemOld.length);
      }
      return orig + transform.stemAffix;
    default:
      // fallback-space: no shared stem to rewrite, so prefix with the new root name,
      // matching how the original is written (compact or spaced).
      return prefixWithNewRoot(orig, transform.affix);
  }
}

function prefixWithNewRoot(orig, affix) {
  const root = (affix ?? '').trim();
  if (!root) return orig;
  if (!/\s/.test(orig) && orig === orig.toLowerCase()) {
    return root.replace(/\s+/g, '').toLowerCase() + orig;
  }
  return `${root} ${orig}`;
}

export function duplicateNameUnchanged(originalName, newName) {
  return originalName.trim().toLowerCase() === newName.trim().toLowerCase();
}

export function findUnchangedDuplicateEntries(changeset) {
  const entries = [];
  if (changeset.skill && duplicateNameUnchanged(changeset.skill.originalName, changeset.skill.newName)) {
    entries.push({ kind: "skill", entry: changeset.skill });
  }
  for (const missile of changeset.missiles ?? []) {
    if (duplicateNameUnchanged(missile.originalName, missile.newName)) {
      entries.push({ kind: "missile", entry: missile });
    }
  }
  return entries;
}

/**
 * Analyse which rows need to be duplicated for a skill.
 * Returns a changeset (plain data the dialog can display and edit).
 * On error returns { error: string }.
 *
 * Changeset shape:
 * {
 *   prefix: string,
 *   skill: { sourceRow, originalName, newName, newId, targetRow },
 *   missiles: [{ sourceRow, originalName, newName, targetRow }, ...]  // topo order, leaves first
 * }
 */
export function resolveSkillDuplicate(skillsDoc, missilesDoc, skillName, newSkillName, excludeMissiles = null, { isProc = false } = {}) {
  const exclude = excludeMissiles ?? EXCLUDE_DEFAULT;

  const sCols = makeColIndex(skillsDoc);
  const mCols = makeColIndex(missilesDoc);

  const skillNameColIdx   = sCols.get('skill') ?? -1;
  const skillIdColIdx     = sCols.get('id') ?? -1;
  const missileNameColIdx = mCols.get('missile') ?? -1;

  if (skillNameColIdx < 0) return { error: 'Skills.txt: "skill" column not found' };
  if (missileNameColIdx < 0) return { error: 'Missiles.txt: "Missile" column not found' };

  const skillByName = makeRowIndex(skillsDoc, skillNameColIdx);
  const sourceRow = skillByName.get(skillName.trim().toLowerCase());
  if (sourceRow == null) return { error: `Skill not found: "${skillName}"` };
  if (skillByName.has(newSkillName.trim().toLowerCase())) return { error: `Skill already exists: "${newSkillName}"` };

  const sl = skillName.trim();
  const nl = newSkillName.trim();
  const transform = detectNameTransform(sl, nl);

  const missileByName = makeRowIndex(missilesDoc, missileNameColIdx);
  const subColIdxs = MISSILE_SUB_COLS.map(c => mCols.get(c) ?? -1);
  const skillMissileColIdxs = SKILL_MISSILE_COLS.map(c => sCols.get(c) ?? -1);

  const rootMissiles = skillMissileColIdxs
    .map(idx => idx >= 0 ? skillsDoc.getCell(sourceRow, idx).trim() : '')
    .filter(Boolean);

  const { included, excluded: skippedMissiles } = collectMissileTree(rootMissiles, missileByName, missilesDoc, subColIdxs, exclude);
  const missileIdColIdx = mCols.get('id') ?? -1;
  const nextMissileId = makeIdSuggester(missilesDoc, missileIdColIdx, { nameColIdx: missileNameColIdx });
  const nextSkillId = makeIdSuggester(skillsDoc, skillIdColIdx, { isProc, nameColIdx: skillNameColIdx, skillRanges: true });

  const buildEntry = (ml, isExcluded) => {
    const srcRow = missileByName.get(ml);
    const origName = srcRow != null ? missilesDoc.getCell(srcRow, missileNameColIdx).trim() : ml;
    return {
      sourceRow: srcRow ?? -1,
      originalName: origName,
      newName: deriveMissileNewName(origName, transform, { oldSkillName: sl, newSkillName: nl }),
      targetId: null,
      excluded: isExcluded
    };
  };

  const missiles = assignIds(bySourceRow([...included].map(ml => buildEntry(ml, false))), nextMissileId);
  const excludedMissiles = bySourceRow([...skippedMissiles].map(ml => buildEntry(ml, true)));

  return {
    transform,
    isProc,
    skill: { sourceRow, originalName: sl, newName: nl, targetId: nextSkillId() },
    missiles,
    excludedMissiles,
  };
}

/**
 * Analyse which missiles need to be duplicated starting from a root missile name.
 * Returns a changeset with only a `missiles` array (no skill entry).
 * On error returns { error: string }.
 */
export function resolveMissileDuplicate(missilesDoc, missileName, newMissileName, excludeMissiles = null) {
  const exclude = excludeMissiles ?? EXCLUDE_DEFAULT;
  const mCols = makeColIndex(missilesDoc);
  const missileNameColIdx = mCols.get('missile') ?? -1;

  if (missileNameColIdx < 0) return { error: 'Missiles.txt: "Missile" column not found' };

  const missileByName = makeRowIndex(missilesDoc, missileNameColIdx);
  const sl = missileName.trim();
  const nl = newMissileName.trim();

  if (!missileByName.has(sl.toLowerCase())) return { error: `Missile not found: "${sl}"` };
  if (missileByName.has(nl.toLowerCase())) return { error: `Missile already exists: "${nl}"` };

  const transform = detectNameTransform(sl, nl);
  const subColIdxs = MISSILE_SUB_COLS.map(c => mCols.get(c) ?? -1);
  const { included, excluded: skippedMissiles } = collectMissileTree([sl], missileByName, missilesDoc, subColIdxs, exclude);
  const nextId = makeIdSuggester(missilesDoc, mCols.get('id') ?? -1, { nameColIdx: missileNameColIdx });

  const buildEntry = (ml, isExcluded) => {
    const srcRow = missileByName.get(ml);
    const origName = srcRow != null ? missilesDoc.getCell(srcRow, missileNameColIdx).trim() : ml;
    return {
      sourceRow: srcRow ?? -1,
      originalName: origName,
      newName: deriveMissileNewName(origName, transform, {
        sourceMissileName: sl,
        newMissileName: nl,
        isSourceMissile: ml === sl.toLowerCase()
      }),
      targetId: null,
      excluded: isExcluded
    };
  };

  const missiles = assignIds(bySourceRow([...included].map(ml => buildEntry(ml, false))), nextId);
  const excludedMissiles = bySourceRow([...skippedMissiles].map(ml => buildEntry(ml, true)));

  return { transform, missiles, excludedMissiles };
}

/**
 * Build the missile remap from a (possibly user-edited) changeset.
 * Returns Map<originalName.toLowerCase(), newName>.
 */
export function buildMissileRemap(changeset) {
  return new Map(changeset.missiles.map(m => [m.originalName.toLowerCase(), m.newName]));
}

/**
 * Build the full row value array for a missile entry, applying name and reference remaps.
 * overrideId: if provided, replaces the copied Id with the target slot's Id.
 */
export function buildMissileValues(missilesDoc, entry, remap, origSkillName, newSkillName, overrideId = null) {
  const mCols = makeColIndex(missilesDoc);
  const values = entry.sourceRow >= 0 ? getRowValues(missilesDoc, entry.sourceRow) : Array(missilesDoc.columnCount).fill('');

  function set(col, val) { const idx = mCols.get(col.toLowerCase()); if (idx != null) values[idx] = val; }

  set('Missile', entry.newName);
  if (overrideId != null) set('Id', overrideId);

  const skillIdx = mCols.get('skill');
  if (skillIdx != null && origSkillName && values[skillIdx].trim().toLowerCase() === origSkillName.toLowerCase()) {
    values[skillIdx] = newSkillName;
  }

  for (const col of MISSILE_SUB_COLS) {
    const idx = mCols.get(col);
    if (idx == null) continue;
    const val = values[idx].trim();
    if (val && remap.has(val.toLowerCase())) values[idx] = remap.get(val.toLowerCase());
  }

  return values;
}

/**
 * Build the full row value array for the skill entry, applying name and missile remaps.
 * overrideId: if provided, uses target slot's existing Id instead of nextFreeId.
 */
export function buildSkillValues(skillsDoc, entry, remap, overrideId = null) {
  const sCols = makeColIndex(skillsDoc);
  const values = getRowValues(skillsDoc, entry.sourceRow);

  function set(col, val) { const idx = sCols.get(col.toLowerCase()); if (idx != null) values[idx] = val; }

  set('skill', entry.newName);
  set('Id', overrideId ?? String(entry.newId));
  set('charclass', '');
  set('skilldesc', '');
  set('cost mult', '');
  set('cost add', '0');
  set('*comment', `Copy of ${entry.originalName}`);

  for (const col of SKILL_MISSILE_COLS) {
    const idx = sCols.get(col.toLowerCase());
    if (idx == null) continue;
    const val = values[idx].trim();
    if (val && remap.has(val.toLowerCase())) values[idx] = remap.get(val.toLowerCase());
  }

  return values;
}
