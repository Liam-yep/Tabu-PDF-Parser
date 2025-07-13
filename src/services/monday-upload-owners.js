import initMondayClient from 'monday-sdk-js';
import logger from '../services/logger/index.js';
import { accountConfig } from '../helpers/config/account-config.js';

const TAG = "monday-upload-owners";

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

export async function sendOwnersToMonday(token, dfOwners, subunitIdMap, accountId) {
  const mondayClient = initMondayClient();
  mondayClient.setApiVersion('2024-07');
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }

  const { account_name, owners } = config;
  logger.debug("sendOwnersToMonday", TAG, {"account_name": account_name, "owners" : owners})
  const { boardId, columnMap, source_column_id} = owners;

  const failedOwners = [];

  for (const row of dfOwners) {
    const subunitId = String(row["תת חלקה"]).trim();
    const subunitItemId = subunitIdMap[subunitId];

    if (!subunitItemId) {
      console.warn(`⚠️ לא נמצא item_id לתת חלקה ${subunitId} — דילוג`);
      continue;
    }
    
    const itemName = String(row["שם בעלים"]).trim();
    const columnValues = {
      [columnMap["תעודת זהות"]]: String(row["תעודת זהות"]).trim(),
      [columnMap["אחוז אחזקה בתת החלקה"]]: parsePercentage(row["אחוז אחזקה בתת החלקה"]),
      [columnMap["תת חלקה"]]: { item_ids: [parseInt(subunitItemId)] },
      [source_column_id]: { label: "נסח טאבו" },
      [columnMap["סוג זיהוי"]]: { labels: [String(row["סוג זיהוי"]).trim()] },
      [columnMap["סוג הבעלות"]]: { labels: [String(row["סוג הבעלות"]).trim()] },
    };

    let attempt = 0;
    let success = false;

    while (attempt < 3 && !success) {
      try {
        attempt++;
        const response = await mondayClient.api(`
          mutation {
            create_item (
              board_id: ${boardId},
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
        console.error("sendOwnersToMonday", TAG, {"❌ Attempt": attempt,"Error creating owner item" :itemName, "error": error});
      }

      if (!success && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 *5* attempt)); // Wait 1s, 2s
      }
    }

    if (!success) {
      const nameAndSubUnit = `דייר - ${itemName} תת חלקה - ${subunitId}`;
      logger.error("sendOwnersToMonday", TAG, { "Failed permanently after 3 attempts": nameAndSubUnit });
      failedOwners.push(nameAndSubUnit);
    }
  }
  return failedOwners;
}

