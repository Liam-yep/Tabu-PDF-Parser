import initMondayClient from 'monday-sdk-js';

const SUBUNIT_BOARD_ID = 1923677090;
const TAG = "monday-upload-subunits";

const columnMap = {
  "החלק ברכוש המשותף": "numeric_mkq62m7k",
  "תיאור קומה": "color_mkq6ytpj",
  "שטח במר": "numeric_mks1ka3t",
  "משכנתה": "color_mkr56hf9",
  "קשר לחלקה": "board_relation_mkq7xz0x"
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
    console.warn(`⚠️ לא ניתן לפרש את ערך האחוז: '${value}'`);
    return 0;
  }
}

export async function sendSubunitsToMonday(token, dfUnits, parentItemId, unitNumber) {
const mondayClient = initMondayClient();
  mondayClient.setApiVersion('2024-07');
  mondayClient.setToken(token);

  const subunitIdMap = {};
  const failedSubunits = [];

  for (const row of dfUnits) {
    const subunitId = String(row["תת חלקה"]).trim();
    const itemName = `${unitNumber} - ${subunitId}`;

    const columnValues = {
      [columnMap["החלק ברכוש המשותף"]]: parsePercentage(row["החלק ברכוש המשותף"]),
      [columnMap["תיאור קומה"]]: { label: row["תיאור קומה"] },
      [columnMap["שטח במר"]]: parseFloat(row["שטח במר"]),
      [columnMap["משכנתה"]]: { label: row["משכנתה"] },
      [columnMap["קשר לחלקה"]]: { item_ids: [parseInt(parentItemId)] }
    };

    let attempt = 0;
    let success = false;

    while (attempt < 3 && !success) {

      try {
        attempt++;
        const response = await mondayClient.api(`
          mutation {
            create_item (
              board_id: ${SUBUNIT_BOARD_ID},
              item_name: "${itemName}",
              column_values: ${JSON.stringify(JSON.stringify(columnValues))},
              create_labels_if_missing: true
            ) {
              id
            }
          }
        `);

        const itemId = response?.data?.create_item?.id;
        if (itemId) {
          subunitIdMap[subunitId] = itemId;
          success = true;
        } else {
          console.error(`❌ Attempt ${attempt} failed to create item: ${itemName}`);
          if (response.errors) {
            console.error(JSON.stringify(response.errors, null, 2));
          }
        }
      } catch (error) {
        console.error(`❌ Attempt ${attempt} – Error creating item ${itemName}:`, error);
      }

      if (!success && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 *5* attempt)); // Wait 1s, 2s
      }
    }

    if (!success) {
      logger.error("sendSubunitsToMonday", TAG, {"Failed permanently after 3 attempts":itemName});
      failedSubunits.push(itemName);
    }
  }

  return { subunitIdMap, failedSubunits };
}
