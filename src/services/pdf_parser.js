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
      if (!text) continue;

      if (!linesMap[y]) {
        linesMap[y] = [];
      }

      linesMap[y].push({ x, text });
    }

    const sortedYs = Object.keys(linesMap)
      .map(Number)
      .sort((a, b) => b - a);

    for (const y of sortedYs) {
      const lineItems = linesMap[y]
        .sort((a, b) => a.x - b.x)
        .map(i => i.text);
      const lineText = lineItems.join(" ");
      allLines.push(lineText);
    }
  }

  return allLines;
}

function cleanLinesFromHeaderBlock(lines) {
  let unitNumber = null;
  let unitNumberFound = false;
  let j = 0;

  while (!unitNumberFound && j < lines.length) {
    const line = lines[j];
    if (line.includes("גוש") && line.includes("חלקה")) {
      const parts = line.split(/\s+/);
      unitNumber = parts[0] || null;
      unitNumberFound = true;
    }
    j++;
  }

  const cleaned = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\d+\s+מתוך\s+\d+\s+עמוד$/.test(line)) {
      i += 9; // דלג על 10 שורות (כולל הנוכחית)
      continue;
    }

    if (line === "סוף נתונים") {
      break;
    }

    cleaned.push(line);
    i++;
  }

  return [cleaned, unitNumber];
}

function splitIntoSubUnits(lines) {
  const subUnits = [];
  let currentUnit = [];

  for (const line of lines) {
    // שורה שמסמנת התחלה של תת-חלקה
    if (/^\d+\s+תת\s+חלקה$/.test(line)) {
      if (currentUnit.length > 0) {
        subUnits.push(currentUnit);
      }
      currentUnit = [line];
    } else {
      if (currentUnit.length > 0) {
        currentUnit.push(line);
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
  const [cleanedLines, unitNumber] = cleanLinesFromHeaderBlock(rawLines);
  const subUnits = splitIntoSubUnits(cleanedLines);
  return { subUnits, unitNumber };
}

function removeParentheses(text) {
  return text.replace(/[()״"]/g, " ").trim();
}

function parseOwnerLine(line) {
  const owner = {
    "תת חלקה": null,
    "שם בעלים": null,
    "תעודת זהות": null,
    "אחוז אחזקה בתת החלקה": null,
  };

  let id = "";
  let ownership = "";

  const stopPattern = /(ירושה על פי הסכם|ירושה|ללא תמורה|מכר ללא תמורה|מכר|שנוי שם|תיקון טעות סופר|צוואה|רישום בית משותף|עודף)/;
  const match = line.match(stopPattern);
  if (match) {
    line = line.replace(match[0], "").trim();
  }

  line = line.replace(" / ", "/");

  if (line.includes("ת.ז")) {
    const parts = line.split("ת.ז");
    if (parts.length !== 2) {
      console.warn("⚠️ לא זוהתה תבנית 'ת.ז' תקינה בשורה:", line);
      return null;
  }
  } else if (line.includes("חברה")) {
    const parts = line.split("חברה");
  }
  

  const name = removeParentheses(parts[1]).trim();
  owner["שם בעלים"] = name;

  const partOneSplit = parts[0].trim().split(/\s+/);
  if (partOneSplit.length < 2) {
    console.warn("⚠️ פורמט לא תקני בשורת בעלים:", line);
    return null;
  }
  if (partOneSplit.length === 3) {
    id = partOneSplit[partOneSplit.length - 1];
    ownership = partOneSplit[partOneSplit.length - 2];
  } else if (partOneSplit.length === 4) {
    id = [partOneSplit[partOneSplit.length - 2], partOneSplit[partOneSplit.length - 1]].join("");
    ownership = partOneSplit[partOneSplit.length - 3];
  }
  owner["תעודת זהות"] = id
    if (ownership === "בשלמות") {
        ownership = 100.0;
    }
  owner["אחוז אחזקה בתת החלקה"] = ownership;
  

  return owner;
}

function extractOwners(lines, subunitId) {
  const owners = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes("בעלויות")) {
      let j = i + 1;

      while (j < lines.length) {
        let currLine = lines[j].trim();

        // תנאים שמסמנים סוף מקטע בעלים
        const validOwnerPattern = /(ירושה על פי הסכם|ירושה|ללא תמורה|מכר ללא תמורה|מכר|שנוי שם|תיקון טעות סופר|צוואה|רישום בית משותף|עודף)/;
        if (!validOwnerPattern.test(currLine)) {
            if (currLine.includes("הערות") || currLine.includes("תת חלקה") || currLine.includes("משכנתאות")) {
            break; // סיום מקטע בעלים
          }
          
          j++;
          if (j >= lines.length){
            break
          }
 
          currLine = lines[j].trim();
          if (!validOwnerPattern.test(currLine)) {
            break;
          }
        }

        const owner = parseOwnerLine(currLine);
        if (owner) {
          owner["תת חלקה"] = subunitId;
          owners.push(owner);
        }

        j++;
      }
    }
  }

  return owners;
}

function extractSubunitData(lines, subunitId) {
  const isMortgage = lines.some(line => line.includes("משכנתה"));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("שטח") && line.includes('במ"ר') && i + 1 < lines.length) {
      const dataLine = lines[i + 1].trim().replace(" / ", "/");
      const parts = dataLine.split(/\s+/);
      const partInCommon = parts[0];
      const unitArea = parts[parts.length - 1];
      let floor = parts[parts.length - 2];

      // תיקון RTL במידת הצורך (אם הטקסט כולל אותיות עבריות)
    //   if (/[\u0590-\u05FF]/.test(floor)) {
    //     floor = floor.split("").reverse().join("");
    //   }

      return [{
        "תת חלקה": subunitId,
        "החלק ברכוש המשותף": partInCommon,
        "תיאור קומה": floor,
        "שטח במר": unitArea,
        "משכנתה": isMortgage ? "קיימת" : "לא קיימת"
      }];
    }
  }

  return [];
}

function extractSubunitId(lines) {
  for (const line of lines) {
    if (line.includes("תת חלקה")) {
      const match = line.match(/^(\d+)\s+תת\s+חלקה$/);
      if (match) {
        return match[1];
      }
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
  return [subunitData, ownersData];
}

function parseSubdivisions(subdivisionBlocks) {
  const allSubunits = [];
  const allOwners = [];

  for (const block of subdivisionBlocks) {
    const [subunitData, ownersData] = parseSubunitBlock(block);
    allSubunits.push(...subunitData);
    allOwners.push(...ownersData);
  }

  return [allSubunits, allOwners];
}


export async function processPdfFile(filePath) {
  const { subUnits, unitNumber } = await extractTextBlocks(filePath);
  console.log("🔢 מספר יחידה:", unitNumber);
  console.log("📦 כמות תתי־יחידות:", subUnits.length);

  const [subunitData, ownersData] = parseSubdivisions(subUnits);

  return { unitNumber, subunitData, ownersData };
}