import initMondayClient from 'monday-sdk-js';

const OWNER_BOARD_ID = 1965912135;

const ownerColumnMap = {
  "תעודת זהות": "text_mkr4jcrv",
  "אחוז אחזקה בתת החלקה": "numeric_mkr4ytb2",
  "תת חלקה": "board_relation_mkr4hh21"
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

export async function sendOwnersToMonday(token, dfOwners, subunitIdMap) {
  const mondayClient = initMondayClient();
  mondayClient.setApiVersion('2024-07');
  mondayClient.setToken(token);

  for (const row of dfOwners) {
    const subunitId = String(row["תת חלקה"]).trim();
    const subunitItemId = subunitIdMap[subunitId];

    if (!subunitItemId) {
      console.warn(`⚠️ לא נמצא item_id לתת חלקה ${subunitId} — דילוג`);
      continue;
    }

    const itemName = String(row["שם בעלים"]).trim();
    const columnValues = {
      [ownerColumnMap["תעודת זהות"]]: String(row["תעודת זהות"]).trim(),
      [ownerColumnMap["אחוז אחזקה בתת החלקה"]]: parsePercentage(row["אחוז אחזקה בתת החלקה"]),
      [ownerColumnMap["תת חלקה"]]: { item_ids: [parseInt(subunitItemId)] }
    };

    let attempt = 0;
    let success = false;

    while (attempt < 3 && !success) {
      try {
        attempt++;

        const response = await mondayClient.api(`
          mutation {
            create_item (
              board_id: ${OWNER_BOARD_ID},
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
          success = true;
        } else {
          console.error(`❌ Attempt ${attempt} failed to create owner item: ${itemName}`);
          if (response.errors) {
            console.error(JSON.stringify(response.errors, null, 2));
          }
        }

      } catch (error) {
        console.error(`❌ Attempt ${attempt} – Error creating owner item ${itemName}:`, error);
      }

      if (!success && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Wait 1s, 2s
      }
    }

    if (!success) {
      console.error(`🚨 Failed permanently after 3 attempts: ${itemName}`);
    }
  }
}

