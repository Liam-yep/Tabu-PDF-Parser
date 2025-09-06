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
      const nextLine = lines[i + 9];
      const nextText = nextLine?.items.map(it => it.text).join(" ") || "";
      const hasExtraHeader = nextText.includes("משותף עם חלקות / גושים");
      i += hasExtraHeader ? 10 : 9;
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


function parseOwnerLine(lineItems, callerFunction="extractOwners") {
  const ownershipLabel = callerFunction === "extractOwners" ? "בעלות" : "חכירות";

  const owner = {
    "תת חלקה": null,
    "שם בעלים": null,
    "תעודת זהות": null,
    "אחוז אחזקה בתת החלקה": null,
    "סוג זיהוי": null,
    "מספר רישום בעלות": null, // הערך הכי שמאלי תחת בעלויות לדוגמה 6924/1990/2
    "פירוט הבעלות": null, // הערך הכי ימני לדוגמה מכר או צוואה
    "סוג בעלות": ownershipLabel // "לבחירת הלייבל במאנדיי: "בעלות" / "חכירות"
  };

  const xMap = {
    ownershipRegistrationNumber:  [0, 106],  // מספר רישום בעלות
    share: [106, 167],     // אחוז אחזקה
    id:    [167, 244],     // ת"ז
    typeOfId: [244, 319],  // סוג זיהוי
    name:  [319, 446],      // שם בעלים
    transferType:  [446, 564],  // פירוט הבעלות
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
  owner["פירוט הבעלות"] = transferType?.trim() || null;


  return owner;
}


function extractLeases(lines, subunitId) {
  const lessees = [];
  let lastLessee = null;
  let checked_continued_line = false;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].items.map(it => it.text).join(" ").trim();
    if (t.includes("חכירות")) {
      let j = i + 1;

      while (j < lines.length) {
        const currLineObj = lines[j];
        const currText = currLineObj.items.map(it => it.text).join(" ").trim();

        const validOwnerPattern = /(ירושה על פי הסכם|ירושה|ללא תמורה|מכר לפי צו בית משפט|מכר ללא תמורה|מכר|שנוי שם|תיקון טעות סופר|צוואה על פי הסכם|צוואה|רישום בית משותף|עודף|עדכון פרטי זיהוי|צוואה - יורש אחר יורש|שכירות|ת.ז|דרכון)/;

        if (!validOwnerPattern.test(currText)) {
          const lessee = parseOwnerLine(currLineObj.items, "extractLeases");
          if (lessee["שם בעלים"] && lessee["פירוט הבעלות"] && lessee["אחוז אחזקה בתת החלקה"]){
            console.log("סוג בעלות לא מוכר", lessee["פירוט הבעלות"])
            lessee["תת חלקה"] = subunitId;
            lastLessee = lessee;
            lessees.push(lessee);
          }

          else if (
            currText.includes("הערות") ||
            currText.includes("תת חלקה") ||
            currText.includes("משכנתאות") ||
            currText.includes("הצמדות") ||
            currText.includes("זיקות הנאה") ||
            currText.includes("בעלויות") ||
            currText.includes("רמה") ||
            currText.includes("חלק בנכס")
          ) { break;}

          else if (checked_continued_line) {
            break
          } 
            // אחרת, שורת המשך — נצרף אותה לשם של הבעלים האחרון
          else if (lastLessee && lessee["שם בעלים"]) {
            lastLessee["שם בעלים"] += " " + removeParentheses(lessee["שם בעלים"]);
          } else if (lastLessee) {
            checked_continued_line = true; // נמנע מלכוד שורות המשך נוספות
          }
          else {
            console.warn(`⚠️ בעיה עם תת חלקה ${subunitId} בזמן חילוץ חכירות`);
            return [];
          }

        } else {
          const lease = parseOwnerLine(currLineObj.items, "extractLeases");
          checked_continued_line = false; // איפוס הדגל
          if (lease) {
            const hasValidName = !!lease["שם בעלים"];
            if (!hasValidName) {
              console.warn("⚠️ שורת בעלים לא תקינה – חסר שם");
              return null;
            }
            lease["תת חלקה"] = subunitId;
            lastLessee = lease;
            lessees.push(lease);
          }
        }
        j++;
      }
    }
  }

  return lessees;
}


function extractOwners(lines, subunitId) {
  const leasesData = extractLeases(lines, subunitId);
  
  const owners = [];
  let lastOwner = null;
  let checked_continued_line = false;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].items.map(i => i.text).join(" ");

    if (lineText.includes("בעלויות")) {
      let j = i + 1;

      while (j < lines.length) {
        const currLineObj = lines[j];
        const currText = currLineObj.items.map(i => i.text).join(" ").trim();

        const validOwnerPattern = /(ירושה על פי הסכם|ירושה|ללא תמורה|מכר לפי צו בית משפט|מכר ללא תמורה|מכר|שנוי שם|תיקון טעות סופר|צוואה על פי הסכם|צוואה|רישום בית משותף|עודף|עדכון פרטי זיהוי|צוואה - יורש אחר יורש|שכירות)/;

        // תנאי עצירה (הערות, תת חלקה, חכירות וכו׳)
        if (!validOwnerPattern.test(currText)) {
          const owner = parseOwnerLine(lines[j].items);
          if (owner["שם בעלים"] && owner["פירוט הבעלות"] && owner["אחוז אחזקה בתת החלקה"]){
            console.log("סוג בעלות לא מוכר", owner["פירוט הבעלות"])
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

          else if (checked_continued_line) {
            break
          }
            // אחרת, שורת המשך — נצרף אותה לשם של הבעלים האחרון
          else if (lastOwner && owner["שם בעלים"]) {
            lastOwner["שם בעלים"] += " " + removeParentheses(owner["שם בעלים"]);
            
          } else if (lastOwner) {
            checked_continued_line = true; // נמנע מלכוד שורות המשך נוספות
          }

          else {
            console.warn(`⚠️ בעיה עם תת חלקה ${subunitId} בזמן חילוץ בעלים`);
            return [];
          }

        } else {
          const owner = parseOwnerLine(lines[j].items); // ✅ שימוש במבנה החדש
          checked_continued_line = false; // איפוס הדגל
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
  owners.push(...leasesData);

  return owners;
}


function extractNotes(lines, startIndex) {
  const xMap = {
    type: [446, 564],     // הערך שמתחיל פסקה של הערות
  };
  const notes = [];
  let index = startIndex+1;

  while (index < lines.length) {
    const nextLine = lines[index];
    // const nextText = nextLine.items.map(i => i.text).join(" ").trim();
    const nextText = nextLine.items
    .slice()
    .sort((a, b) => b.xLeft - a.xLeft)  // מיין מימין לשמאל
    .map(i => i.text)
    .join(" ")
    .trim();


    if (nextText.includes("תת חלקה") || nextText.includes("משכנתאות") || nextText.includes("חכירות") || nextText.includes("הצמדות") || nextText.includes("זיקות הנאה")) {
      break; // עצירה: התחלף פרק במסמך
    }
    
    notes.push(nextText);
    index++;
    }
  const str = notes.join("\n").trim();
  return str;
}



function extractAttachments(lines, startIndex) {
  const xMap = {
    area_of_attachment: [0, 106],     // "שטח במ"ר(הצמדות)"
    attachment_description: [182, 407],     // "תיאור הצמדה"
  };
  const result = {}
  let index = startIndex;
  const validKeywords = ["גג", "חניה", "מחסן"];
  const valueLine = lines[index + 1]?.items;

  if (!valueLine || !valueLine.some(item => item.text.includes("תיאור הצמדה"))) {
    return null;
  }

  while (true) {
    index +=1
    const valueLine = lines[index + 1]?.items;
    const currText = valueLine.map(i => i.text).join(" ");

    if (
      currText.includes("הערות") ||
      currText.includes("תת חלקה") ||
      currText.includes("משכנתאות") ||
      currText.includes("חכירות") ||
      currText.includes("זיקות הנאה")
    ) {
      break;  // עצירה: התחלף פרק במסמך
    }
    
    const area_of_attachment = extractTextFromXRange(valueLine, ...xMap.area_of_attachment)
    const attachment_description = extractTextFromXRange(valueLine, ...xMap.attachment_description).trim()

    const float_area_of_attachment = parseFloat(area_of_attachment?.replace(",", ".") || "0");
    if (!attachment_description || isNaN(float_area_of_attachment)) break;

    const matchedKeyword = validKeywords.find(keyword => attachment_description.includes(keyword));
    if (!matchedKeyword) break;

    if (!result[matchedKeyword]) {
      result[matchedKeyword] = { count: 1, total_area: float_area_of_attachment };
    } else {
      result[matchedKeyword].count += 1;
      result[matchedKeyword].total_area += float_area_of_attachment;
    }
  }
  return Object.keys(result).length ? result : null;

}


function extractSubunitData(lines, subunitId) {
  let shared, floor, area, bank;
  let find_subunit_data = false;
  let find_mortgage = false;
  let attachments = false
  let notes = "";

  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i];
    const headerText = headerLine.items.map(i => i.text).join(" ").trim();

    if (!find_subunit_data && headerText.includes("שטח") && headerText.includes('במ"ר') && i + 1 < lines.length) {
      const valueLine = lines[i + 1].items;
      find_subunit_data = true

      const xMap = {
        shared: [14, 106],     // "החלק ברכוש המשותף"
        floor: [276, 464],     // "תיאור קומה"
        area: [510, 564]       // "שטח במר"
      };
      shared = extractTextFromXRange(valueLine, ...xMap.shared)
      floor = extractTextFromXRange(valueLine, ...xMap.floor)
      area = extractTextFromXRange(valueLine, ...xMap.area)
    }

    if (!find_mortgage && headerText.includes("משכנתאות") && i + 1 < lines.length){
      const valueLine = lines[i + 1].items;
      if (!valueLine.some(item => item.text.includes("משכנת"))) {
        continue;
      }
      find_mortgage = true

      const xMap = {
        bank: [319, 446],     // "משכנתא - בנק"
      };
      bank = extractTextFromXRange(valueLine, ...xMap.bank)
    }

    if (headerText.includes("הצמדות")){
      attachments = extractAttachments(lines, i);
    }

    if (headerText.includes("הערות")) {
      const notesTitleItem = headerLine.items.find(
        item =>
          item.text.includes("הערות") &&
          item.xLeft >= 511.4 &&
          item.xRight <= 535.1
      );
      if (notesTitleItem) {
        notes = extractNotes(lines, i);
      }
    }


  }
  return [{
    "תת חלקה": subunitId,
    "החלק ברכוש המשותף": shared || "לא נמצא",
    "תיאור קומה": floor || "לא נמצא",
    "שטח במר": area || "לא נמצא",
    "משכנתה": find_mortgage ? "קיימת" : "לא קיימת",
    "משכנתה - בנק": bank || "",
    "הצמדות - קיים": attachments ? true : false,
    "הצמדות - פירוט": attachments,
    "פירוט הערות": notes || "",
  }];
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
  const failedSubunits = [];

  for (const block of subdivisionBlocks) {
    const [subunitData, ownersData, subunitId] = parseSubunitBlock(block);
    allSubunits.push(...subunitData);
    allOwners.push(...ownersData);

    if (!ownersData || ownersData.length === 0) {
      const error_text = `⚠️ שגיאה במידע על בעלים של תת חלקה ${subunitId}`
      failedOwners.push(error_text);
    }

    if (!subunitData || subunitData.length === 0) {
      const error_text = `⚠️ שגיאה במידע על תת חלקה ${subunitId}`
      failedSubunits.push(error_text)
    }
  }
  return [allSubunits, allOwners, failedOwners, failedSubunits];
}


export async function processPdfFile(filePath) {
  try {
    const { subUnits, unitNumber, blockNumber } = await extractTextBlocks(filePath);
    console.log("🔢 מספר יחידה:", unitNumber, "מספר גוש", blockNumber);
    console.log("📦 כמות תתי־יחידות:", subUnits.length);
    const [subunitData, ownersData, failedOwners, failedSubunits] = parseSubdivisions(subUnits);
    return { unitNumber, blockNumber, subunitData, ownersData, failedOwners, failedSubunits};
  } catch (error) {
    console.error("❌ שגיאה בעיבוד קובץ PDF:", error);
    throw error;
  }
}