export const buildMergeKey = (owner, subunitIdMap) => {
  const subunitId = owner.subunitId || subunitIdMap[owner["תת חלקה"]];
  const rawId = owner["תעודת זהות"] ?? owner.nationalId ?? null;
  const cleanId = rawId && rawId !== "null" && rawId !== "" ? rawId : null;

  return `${subunitId} - ${cleanId || owner["שם בעלים"] || owner.name}`;
};



function parsePercentage(value) {
  if (!value) return 0;
  value = value.toString().trim().replace(/\s/g, "");
  if (value === "בשלמות") return 100;
  try {
    if (value.includes("/")) {
      const [num, den] = value.split("/").map(Number);
      return (num / den) * 100;
    } else {
      return parseFloat(value);
    }
  } catch {
    logger.warn(`⚠️ לא ניתן לפרש את ערך האחוז: '${value}'`, TAG);
    return 0;
  }
}


export function mergeDuplicateOwners(parsedOwners, subunitIdMap) {
  const merged = new Map();

  for (const o of parsedOwners) {
    const key = buildMergeKey(o, subunitIdMap);

    // נחשב אחוז כערך מספרי
    const percentage = parsePercentage(o["אחוז אחזקה בתת החלקה"]);
    const ownershipType = o["פירוט הבעלות"]?.trim();

    if (!merged.has(key)) {
      merged.set(key, { 
        ...o, 
        _percentage: percentage, 
        _ownershipTypes: ownershipType ? new Set([ownershipType]) : new Set() 
      });
    } else {
      const existing = merged.get(key);
      existing._percentage += percentage; // צוברים את האחוז
      if (ownershipType) existing._ownershipTypes.add(ownershipType); // צוברים סוגי בעלות שונים
    }
  }

  // מחזירים בחזרה למבנה הרגיל
  return Array.from(merged.values()).map(o => ({
    ...o,
    "אחוז אחזקה בתת החלקה": o._percentage,
    "פירוט הבעלות": { labels: Array.from(o._ownershipTypes) }, // ✅ מותאם לדרופדאון
  }));
}

