import { buildMergeKey } from "./utils.js";


export function prepareSubunitsForSync(existingSubunits, parsedSubunits, unitNumber) {
  const existingMap = new Map(existingSubunits.map(s => [s.name, s]));
  const marked = [];

  // עיבוד מה- PDF
  for (const parsed of parsedSubunits) {
    const identifier = `${unitNumber} - ${parsed['תת חלקה']}`;
    if (existingMap.has(identifier)) {
      const existing = existingMap.get(identifier);
      marked.push({
        ...parsed,
        id: existing.id,
        identifier,
        action: "update"
      });
      existingMap.delete(identifier); // הורד מהמפה כדי שנדע מה נשאר למחיקה
    } else {
      marked.push({
        ...parsed,
        id: null,
        identifier,
        action: "create"
      });
    }
  }

  // מה שנשאר במפה → למחיקה
  for (const existing of existingMap.values()) {
    marked.push({
      id: existing.id,
      identifier: existing.name,
      action: "delete"
    });
  }

  return marked;
}


/**
 * מחלק את הדיירים לשלושה מצבים: יצירה / עדכון / מחיקה
 * @param {Array} existingOwners - דיירים שכבר קיימים בלוח
 * @param {Array} parsedOwners - דיירים חדשים שפורקו מהנסח
 * @param {Object} subunitIdMap - מפת תתי חלקות { "1": "50118...", "2": "50119..." }
 */
export function prepareOwnersForSync(existingOwners, mergedOwners, subunitIdMap) {
  const existingByKey = new Map();

  for (const o of existingOwners) {
    const key = buildMergeKey(o, subunitIdMap);
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(o);
  }

  const marked = [];

  for (const o of mergedOwners) {
    const key = buildMergeKey(o, subunitIdMap);
    const matches = existingByKey.get(key) || [];

    if (matches.length === 1) {
      // עדכון רגיל
      marked.push({ ...o, id: matches[0].id, action: "update" });
      existingByKey.delete(key);
    } else if (matches.length > 1) {
      // איחוד – מעדכנים את הראשון
      marked.push({ ...o, id: matches[0].id, action: "update" });
      // השאר למחיקה
      for (let i = 1; i < matches.length; i++) {
        marked.push({ ...matches[i], action: "delete" });
      }
      existingByKey.delete(key);
    } else {
      // חדש – יצירה
      marked.push({ ...o, id: null, action: "create" });
    }
  }

  // מה שנשאר → למחוק
  for (const leftover of existingByKey.values()) {
    for (const o of leftover) {
      marked.push({ ...o, action: "delete" });
    }
  }

  return marked;
}



