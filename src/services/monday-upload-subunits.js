import initMondayClient from 'monday-sdk-js';
import logger from '../services/logger/index.js';
import { accountConfig } from '../helpers/config/account-config.js';


const TAG = "monday-upload-subunits";


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

export async function sendSubunitsToMonday(token, dfUnits, parentItemId, unitNumber, accountId) {
const mondayClient = initMondayClient();
  mondayClient.setApiVersion('2024-07');
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }

  const { account_name, subunits } = config;
  logger.debug("sendSubunitsToMonday", TAG, {"account_name" : account_name, "subunits" : subunits})
  const { boardId, columnMap, source_column_id } = subunits;

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
      [columnMap["קשר לחלקה"]]: { item_ids: [parseInt(parentItemId)] },
      [source_column_id]: { label: "נסח טאבו" }
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
          subunitIdMap[subunitId] = itemId;
          success = true;
        } else {
          logger.error(`❌ Attempt ${attempt} failed to create item: ${itemName}`, TAG);
          if (response.errors) {
            logger.error(JSON.stringify(response.errors, null, 2), TAG);
          }
        }
      } catch (error) {
        logger.error(`❌ Attempt ${attempt} – Error creating item ${itemName}:`, TAG, {"error":error});
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
