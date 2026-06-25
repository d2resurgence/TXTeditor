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
  const queue = rootNames.map(n => n.toLowerCase()).filter(Boolean);
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name) || exclude.has(name)) continue;
    const row = missileByName.get(name);
    if (row == null) continue;
    visited.add(name);
    for (const idx of subColIdxs) {
      if (idx < 0) continue;
      const sub = missilesDoc.getCell(row, idx).trim().toLowerCase();
      if (sub && !visited.has(sub)) queue.push(sub);
    }
  }
  return visited;
}

function topoSort(missileSet, missileByName, missilesDoc, subColIdxs) {
  const visited = new Set();
  const ordered = [];
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const row = missileByName.get(name);
    if (row != null) {
      for (const idx of subColIdxs) {
        if (idx < 0) continue;
        const sub = missilesDoc.getCell(row, idx).trim().toLowerCase();
        if (sub && missileSet.has(sub)) visit(sub);
      }
    }
    ordered.push(name);
  }
  for (const name of [...missileSet].sort()) visit(name);
  return ordered;
}

function nextFreeId(doc, idColIdx, start = 1024) {
  if (idColIdx < 0) return start;
  const used = new Set();
  for (let r = 1; r < doc.rowCount; r++) {
    const v = parseInt(doc.getCell(r, idColIdx), 10);
    if (!isNaN(v)) used.add(v);
  }
  let n = start;
  while (used.has(n)) n++;
  return n;
}

function makeUnusedSuggester(doc, nameColIdx) {
  const claimed = new Set();
  return function next() {
    for (let r = 1; r < doc.rowCount; r++) {
      if (!claimed.has(r) && doc.getCell(r, nameColIdx).trim().toLowerCase().startsWith('unused')) {
        claimed.add(r);
        return r;
      }
    }
    return -1;
  };
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
export function resolveSkillDuplicate(skillsDoc, missilesDoc, skillName, newSkillName, excludeMissiles = null) {
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
  const prefix = nl.toLowerCase().endsWith(sl.toLowerCase()) ? nl.slice(0, nl.length - sl.length) : nl + ' ';

  const missileByName = makeRowIndex(missilesDoc, missileNameColIdx);
  const subColIdxs = MISSILE_SUB_COLS.map(c => mCols.get(c) ?? -1);
  const skillMissileColIdxs = SKILL_MISSILE_COLS.map(c => sCols.get(c) ?? -1);

  const rootMissiles = skillMissileColIdxs
    .map(idx => idx >= 0 ? skillsDoc.getCell(sourceRow, idx).trim() : '')
    .filter(Boolean);

  const missileSet = collectMissileTree(rootMissiles, missileByName, missilesDoc, subColIdxs, exclude);
  const sorted = topoSort(missileSet, missileByName, missilesDoc, subColIdxs);

  const nextMissileSlot = makeUnusedSuggester(missilesDoc, missileNameColIdx);
  const nextSkillSlot   = makeUnusedSuggester(skillsDoc, skillNameColIdx);

  const missiles = sorted.map(ml => {
    const srcRow = missileByName.get(ml);
    const origName = srcRow != null ? missilesDoc.getCell(srcRow, missileNameColIdx).trim() : ml;
    return { sourceRow: srcRow ?? -1, originalName: origName, newName: prefix + origName, targetRow: nextMissileSlot() };
  });

  return {
    prefix,
    skill: { sourceRow, originalName: sl, newName: nl, newId: nextFreeId(skillsDoc, skillIdColIdx), targetRow: nextSkillSlot() },
    missiles,
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

  const prefix = nl.toLowerCase().endsWith(sl.toLowerCase()) ? nl.slice(0, nl.length - sl.length) : nl + ' ';
  const subColIdxs = MISSILE_SUB_COLS.map(c => mCols.get(c) ?? -1);
  const missileSet = collectMissileTree([sl], missileByName, missilesDoc, subColIdxs, exclude);
  const sorted = topoSort(missileSet, missileByName, missilesDoc, subColIdxs);
  const nextSlot = makeUnusedSuggester(missilesDoc, missileNameColIdx);

  const missiles = sorted.map(ml => {
    const srcRow = missileByName.get(ml);
    const origName = srcRow != null ? missilesDoc.getCell(srcRow, missileNameColIdx).trim() : ml;
    return { sourceRow: srcRow ?? -1, originalName: origName, newName: prefix + origName, targetRow: nextSlot() };
  });

  return { prefix, missiles };
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
 */
export function buildMissileValues(missilesDoc, entry, remap, origSkillName, newSkillName) {
  const mCols = makeColIndex(missilesDoc);
  const values = entry.sourceRow >= 0 ? getRowValues(missilesDoc, entry.sourceRow) : Array(missilesDoc.columnCount).fill('');

  function set(col, val) { const idx = mCols.get(col.toLowerCase()); if (idx != null) values[idx] = val; }

  set('Missile', entry.newName);

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
 */
export function buildSkillValues(skillsDoc, entry, remap) {
  const sCols = makeColIndex(skillsDoc);
  const values = getRowValues(skillsDoc, entry.sourceRow);

  function set(col, val) { const idx = sCols.get(col.toLowerCase()); if (idx != null) values[idx] = val; }

  set('skill', entry.newName);
  set('Id', String(entry.newId));
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
