import fs from "fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function extractTextFromPdf(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await getDocument({ data }).promise;

  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items;
    const linesMap = {};

    for (const item of items) {
      const y = item.transform[5];
      const x = item.transform[4];
      const text = item.str.trim();

      const xRight = x + item.width;

      if (!text) continue;

      if (!linesMap[y]) {
        linesMap[y] = [];
      }

      linesMap[y].push({ xLeft: x, xRight, text });
    }

    const sortedYs = Object.keys(linesMap)
      .map(Number)
      .sort((a, b) => b - a);

    for (const y of sortedYs) {
      const lineItems = linesMap[y].sort((a, b) => a.xLeft - b.xLeft);
      allLines.push({
        y: Number(y),
        items: lineItems
      });
    }
  }

  return allLines;
}

function cleanLinesFromHeaderBlock(lines) {
  let unitNumber = null;
  let blockNumber = null;
  let unitNumberFound = false;
  let j = 0;

  while (!unitNumberFound && j < lines.length) {
    const lineObj = lines[j];
    const textLine = lineObj.items.map(i => i.text).join(" ").trim();

    if (textLine.includes("גוש") && textLine.includes("חלקה")) {
      const parts = textLine.split(/\s+/);
      unitNumber = parts[0] || null;
      blockNumber = parts[2]|| null;
      unitNumberFound = true;
    }
    j++;
  }

  const cleaned = [];
  let i = 0;

  while (i < lines.length) {
    const lineObj = lines[i];
    const textLine = lineObj.items.map(i => i.text).join(" ").trim();

    if (/^\d+\s+מתוך\s+\d+\s+עמוד$/.test(textLine)) {
      i += 9; // דלג על 10 שורות (כולל הנוכחית)
      continue;
    }

    if (textLine === "סוף נתונים") {
      break;
    }

    cleaned.push(lineObj);
    i++;
  }

  return [cleaned, unitNumber, blockNumber];
}


function splitIntoSubUnits(lines) {
  const subUnits = [];
  let currentUnit = [];

  for (const lineObj of lines) {
    const textLine = lineObj.items.map(i => i.text).join(" ").trim();

    // בדיקה אם זו התחלה של תת-חלקה
    if (/^\d+\s+תת\s+חלקה$/.test(textLine)) {
      if (currentUnit.length > 0) {
        subUnits.push(currentUnit);
      }
      currentUnit = [lineObj]; // מתחיל תת חלקה חדשה
    } else {
      if (currentUnit.length > 0) {
        currentUnit.push(lineObj);
      }
    }
  }

  if (currentUnit.length > 0) {
    subUnits.push(currentUnit);
  }

  return subUnits;
}


async function extractTextBlocks(pdfPath) {
  const rawLines = await extractTextFromPdf(pdfPath);
  const [cleanedLines, unitNumber, blockNumber] = cleanLinesFromHeaderBlock(rawLines);
  const subUnits = splitIntoSubUnits(cleanedLines);
  return { subUnits, unitNumber, blockNumber };
}


function removeParentheses(text = "") {
  return text.replace(/[()]/g, "").replace(/[״"]/g, "''").trim();
}


function extractTextFromXRange(lineItems, minX, maxX) {
  return lineItems
    .filter(({ xLeft, xRight }) => xLeft < maxX && xRight > minX)
    .map(({ text }) => text)
    .join(" ")
    .trim();
}


function parseOwnerLine(lineItems) {
  const owner = {
    "תת חלקה": null,
    "שם בעלים": null,
    "תעודת זהות": null,
    "אחוז אחזקה בתת החלקה": null,
    "סוג זיהוי": null,
    "מספר רישום בעלות": null, // הערך הכי שמאלי תחת בעלויות לדוגמה 6924/1990/2
    "סוג הבעלות": null // הערך הכי ימני לדוגמה מכר או צוואה
  };

  const xMap = {
    ownershipRegistrationNumber:  [0, 106],  // מספר רישום בעלות
    share: [106, 167],     // אחוז אחזקה
    id:    [167, 244],     // ת"ז
    typeOfId: [244, 319],  // סוג זיהוי
    name:  [319, 446],      // שם בעלים
    transferType:  [446, 564],  // סוג הבעלות
  };

  const name  = extractTextFromXRange(lineItems, ...xMap.name);
  const id    = extractTextFromXRange(lineItems, ...xMap.id);
  const share = extractTextFromXRange(lineItems, ...xMap.share);
  const typeOfId = extractTextFromXRange(lineItems, ...xMap.typeOfId);
  const ownershipRegistrationNumber = extractTextFromXRange(lineItems, ...xMap.ownershipRegistrationNumber);
  const transferType = extractTextFromXRange(lineItems, ...xMap.transferType);

  owner["שם בעלים"] = removeParentheses(name) || null;
  owner["תעודת זהות"] = id?.trim() || null;
  owner["אחוז אחזקה בתת החלקה"] = (share?.trim() === "בשלמות") ? "100.0" : share?.trim() || null;
  owner["סוג זיהוי"] = typeOfId?.trim() || null;
  owner["מספר רישום בעלות"] = ownershipRegistrationNumber?.trim() || null;
  owner["סוג הבעלות"] = transferType?.trim() || null;


  return owner;
}


function extractOwners(lines, subunitId) {
  const owners = [];
  let lastOwner = null;
  
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].items.map(i => i.text).join(" ");

    if (lineText.includes("בעלויות")) {
      let j = i + 1;

      while (j < lines.length) {
        const currLineObj = lines[j];
        const currText = currLineObj.items.map(i => i.text).join(" ").trim();

        const validOwnerPattern = /(ירושה על פי הסכם|ירושה|ללא תמורה|מכר לפי צו בית משפט|מכר ללא תמורה|מכר|שנוי שם|תיקון טעות סופר|צוואה על פי הסכם|צוואה|רישום בית משותף|עודף|עדכון פרטי זיהוי|צוואה - יורש אחר יורש)/;

        // תנאי עצירה (הערות, תת חלקה, חכירות וכו׳)
        if (!validOwnerPattern.test(currText)) {

          const owner = parseOwnerLine(lines[j].items);
          if (owner["שם בעלים"] && owner["סוג הבעלות"] && owner["אחוז אחזקה בתת החלקה"]){
            owner["תת חלקה"] = subunitId;
            lastOwner = owner;
            owners.push(owner);
          }

          else if (
            currText.includes("הערות") ||
            currText.includes("תת חלקה") ||
            currText.includes("משכנתאות") ||
            currText.includes("חכירות") ||
            currText.includes("הצמדות") ||
            currText.includes("זיקות הנאה")
          ) {
            break;
          }

            // אחרת, שורת המשך — נצרף אותה לשם של הבעלים האחרון
          else if (lastOwner && owner["שם בעלים"]) {
            lastOwner["שם בעלים"] += " " + removeParentheses(owner["שם בעלים"]);
            
          } else {
            console.warn(`⚠️ בעיה עם תת חלקה ${subunitId} בזמן חילוץ בעלים`);
            return null;
          }

        } else {
          const owner = parseOwnerLine(lines[j].items); // ✅ שימוש במבנה החדש
          if (owner) {
            const hasValidName = !!owner["שם בעלים"];
            if (!hasValidName) {
              console.warn("⚠️ שורת בעלים לא תקינה – חסר שם");
              return null;
            }
            owner["תת חלקה"] = subunitId;
            lastOwner = owner;
            owners.push(owner);
          }
        }
        j++;
      }
    }
  }

  return owners;
}


function extractSubunitData(lines, subunitId) {
  const isMortgage = lines.some(line =>
    line.items.some(item => item.text.includes("משכנתאות"))
  );

  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i];
    const headerText = headerLine.items.map(i => i.text).join(" ").trim();

    if (headerText.includes("שטח") && headerText.includes('במ"ר') && i + 1 < lines.length) {
      const valueLine = lines[i + 1].items;

      // 💡 תחליף פה את הערכים לפי ה-Xים הרלוונטיים מתוך ה־PDF שלך
      const xMap = {
        shared: [14, 106],     // "החלק ברכוש המשותף"
        floor: [276, 464],     // "תיאור קומה"
        area: [510, 564]       // "שטח במר"
      };

      return [{
        "תת חלקה": subunitId,
        "החלק ברכוש המשותף": extractTextFromXRange(valueLine, ...xMap.shared),
        "תיאור קומה": extractTextFromXRange(valueLine, ...xMap.floor),
        "שטח במר": extractTextFromXRange(valueLine, ...xMap.area),
        "משכנתה": isMortgage ? "קיימת" : "לא קיימת"
      }];
    }
  }

  return [];
}



function extractSubunitId(lines) {
  for (const line of lines) {
    const textLine = line.items.map(i => i.text).join(" ").trim();
    const match = textLine.match(/^(\d+)\s+תת\s+חלקה$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}


function parseSubunitBlock(block) {
  const subunitId = extractSubunitId(block);

  const subunitData = extractSubunitData(block, subunitId);
  const ownersData = extractOwners(block, subunitId);

  if (ownersData.length === 0) {
    console.warn(`⚠️ לא נמצאו בעלים עבור תת חלקה ${subunitId}`);
  }
  return [subunitData, ownersData, subunitId];
}


function parseSubdivisions(subdivisionBlocks) {
  const allSubunits = [];
  const allOwners = [];
  const failedOwners = [];
  const faileSubunits = [];

  for (const block of subdivisionBlocks) {
    const [subunitData, ownersData, subunitId] = parseSubunitBlock(block);
    allSubunits.push(...subunitData);
    allOwners.push(...ownersData);

    if (ownersData.length === 0) {
    error_text = `⚠️ שגיאה במידע על בעלים של תת חלקה ${subunitId}`
    failedOwners.push(...error_text)
    }

    if (subunitData.length === 0) {
    error_text = `⚠️ שגיאה במידע על תת חלקה ${subunitId}`
    faileSubunits.push(...error_text)
    }
  }
  return [allSubunits, allOwners, failedOwners, faileSubunits];
}


export async function processPdfFile(filePath) {
  try {
    const { subUnits, unitNumber, blockNumber } = await extractTextBlocks(filePath);
    console.log("🔢 מספר יחידה:", unitNumber, "מספר גוש", blockNumber);
    console.log("📦 כמות תתי־יחידות:", subUnits.length);
    const [subunitData, ownersData, failedOwners, faileSubunits] = parseSubdivisions(subUnits);

    return { unitNumber, blockNumber, subunitData, ownersData, failedOwners, faileSubunits};
  } catch (error) {
    console.error("❌ שגיאה בעיבוד קובץ PDF:", error);
    throw error;
  }
}