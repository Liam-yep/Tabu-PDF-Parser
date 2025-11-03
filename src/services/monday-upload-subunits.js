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

function applyAttachmentsToColumns(columnValues, columnMap, attachments) {
  if (!attachments || typeof attachments !== 'object') return columnValues;
  const attachmentColumnKeys = {
    "חניה": {
      countKey: "מספר חניות מוצמדות",
      areaKey: "חנייה מוצמדת במר",
    },
    "גג": {
      countKey: "מספר גגות מוצמדים",
      areaKey: "גג מוצמד במר",
    },
    "מחסן": {
      countKey: "מספר מחסנים מוצמדים",
      areaKey: "מחסן מוצמד במר",
    },
  };

  for (const [type, info] of Object.entries(attachments)) {
    const mapping = attachmentColumnKeys[type];
    if (!mapping) continue;

    const { count, total_area } = info;

    const countColId = columnMap[mapping.countKey];
    const areaColId = columnMap[mapping.areaKey];

    if (countColId) columnValues[countColId] = count;
    if (areaColId) columnValues[areaColId] = total_area;
  }

  return columnValues;
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
    let itemName = `${unitNumber} - ${subunitId}`;

    let columnValues = {
      [columnMap["החלק ברכוש המשותף"]]: parsePercentage(row["החלק ברכוש המשותף"]),
      [columnMap["תיאור קומה"]]: buildColumnValue(columnMap["תיאור קומה"], row["תיאור קומה"]),
      [columnMap["שטח במר"]]: parseFloat(row["שטח במר"]),
      [columnMap["משכנתה"]]: { label: row["משכנתה"] },
      [columnMap["קשר לחלקה"]]: { item_ids: [parseInt(parentItemId)] },
      [source_column_id]: { label: "נסח טאבו" },
      [columnMap["משכנתה - בנק"]]: row["משכנתה - בנק"],
      [columnMap["פירוט הערות"]]: row["פירוט הערות"],
    };

    columnValues = applyAttachmentsToColumns(columnValues, columnMap, row['הצמדות - פירוט'])
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
      if (response?.errors?.[0]?.extensions?.status_code === 500) {
        itemName = `שגיאה פנימית ב Monday. אפשר לנסות שוב מאוחר יותר. ${itemName}`;
      }
      failedSubunits.push(itemName);
    }
  }

  return { subunitIdMap, failedSubunits };
}


function buildColumnValue(columnId, rawValue) {
  if (!rawValue) return null;

  if (columnId.startsWith("dropdown_")) {
    return { labels: [String(rawValue)] };
  }
  if (columnId.startsWith("color_")) {
    return { label: String(rawValue) };
  }
  return String(rawValue); // fallback לטקסט/מספר/אחר
}


export async function syncSubunits(token, markedSubunits, parentItemId, unitNumber, accountId) {
  const subunitIdMap = {};
  const failedSubunits = [];

  for (const sub of markedSubunits) {
    try {
      if (sub.action === "create") {
        const itemId = await createSubunit(token, sub, parentItemId, unitNumber, accountId);
        if (itemId) {
          subunitIdMap[sub["תת חלקה"]] = itemId;
        }
      } else if (sub.action === "update") {
        const itemId = await updateSubunit(token, sub.id, sub, accountId);
        if (itemId) {
          subunitIdMap[sub["תת חלקה"]] = itemId;
        }
      } else if (sub.action === "delete") {
        await deleteSubunit(token, sub.id);
      }
    } catch (err) {
      logger.error(`❌ Failed to ${sub.action} subunit ${sub.identifier}`, "syncSubunits", err);
      failedSubunits.push(sub.identifier);
    }
  }

  return { subunitIdMap, failedSubunits };
}


export async function createSubunit(token, row, parentItemId, unitNumber, accountId) {
  const TAG = "createSubunit";

  const mondayClient = initMondayClient();
  mondayClient.setApiVersion("2024-07");
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) throw new Error(`No config found for account ${accountId}`);
  const { subunits } = config;
  const { boardId, columnMap, source_column_id } = subunits;

  const subunitId = String(row["תת חלקה"]).trim();
  let itemName = `${unitNumber} - ${subunitId}`;

  let columnValues = {
    [columnMap["החלק ברכוש המשותף"]]: parsePercentage(row["החלק ברכוש המשותף"]),
    [columnMap["תיאור קומה"]]: buildColumnValue(columnMap["תיאור קומה"], row["תיאור קומה"]),
    [columnMap["שטח במר"]]: parseFloat(row["שטח במר"]),
    [columnMap["משכנתה"]]: { label: row["משכנתה"] },
    [columnMap["קשר לחלקה"]]: { item_ids: [parseInt(parentItemId)] },
    [source_column_id]: { label: "נסח טאבו" },
    [columnMap["משכנתה - בנק"]]: row["משכנתה - בנק"],
    [columnMap["פירוט הערות"]]: row["פירוט הערות"],
  };

  columnValues = applyAttachmentsToColumns(columnValues, columnMap, row["הצמדות - פירוט"]);

  let attempt = 0;
  let success = false;
  let itemId = null;

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

      itemId = response?.data?.create_item?.id;
      if (itemId) {
        // logger.info(`✅ Created subunit ${itemName} (id=${itemId})`, TAG);
        success = true;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to create subunit: ${itemName}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error creating subunit ${itemName}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  if (!success) {
    logger.error(`❌ Failed permanently to create subunit: ${itemName}`, TAG);
  }

  return itemId;
}


export async function updateSubunit(token, itemId, row, accountId) {
  const TAG = "updateSubunit";

  const mondayClient = initMondayClient();
  mondayClient.setApiVersion("2024-07");
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) throw new Error(`No config found for account ${accountId}`);
  const { subunits } = config;
  const { boardId, columnMap, source_column_id } = subunits;

  let columnValues = {
    [columnMap["החלק ברכוש המשותף"]]: parsePercentage(row["החלק ברכוש המשותף"]),
    [columnMap["תיאור קומה"]]: buildColumnValue(columnMap["תיאור קומה"], row["תיאור קומה"]),
    [columnMap["שטח במר"]]: parseFloat(row["שטח במר"]),
    [columnMap["משכנתה"]]: { label: row["משכנתה"] },
    [source_column_id]: { label: "נסח טאבו" },
    [columnMap["משכנתה - בנק"]]: row["משכנתה - בנק"],
    [columnMap["פירוט הערות"]]: row["פירוט הערות"],
  };

  columnValues = applyAttachmentsToColumns(columnValues, columnMap, row["הצמדות - פירוט"]);

  let attempt = 0;
  let success = false;

  while (attempt < 3 && !success) {
    try {
      attempt++;
      const response = await mondayClient.api(`
        mutation {
          change_multiple_column_values (
            item_id: ${itemId},
            board_id: ${boardId},
            column_values: ${JSON.stringify(JSON.stringify(columnValues))},
            create_labels_if_missing: true
          ) {
            id
          }
        }
      `);

      const updatedId = response?.data?.change_multiple_column_values?.id;
      if (updatedId) {
        // logger.info(`✅ Updated subunit (id=${itemId})`, TAG);
        success = true;
        return updatedId;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to update subunit id=${itemId}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error updating subunit id=${itemId}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  logger.error(`❌ Failed permanently to update subunit id=${itemId}`, TAG);
  return null;
}


export async function deleteSubunit(token, itemId) {
  const TAG = "deleteSubunit";

  const mondayClient = initMondayClient();
  mondayClient.setApiVersion("2024-07");
  mondayClient.setToken(token);

  let attempt = 0;
  let success = false;

  while (attempt < 3 && !success) {
    try {
      attempt++;
      const response = await mondayClient.api(`
        mutation {
          delete_item (item_id: ${itemId}) {
            id
          }
        }
      `);

      const deletedId = response?.data?.delete_item?.id;
      if (deletedId) {
        // logger.info(`✅ Deleted subunit (id=${itemId})`, TAG);
        success = true;
        return deletedId;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to delete subunit id=${itemId}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error deleting subunit id=${itemId}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  logger.error(`❌ Failed permanently to delete subunit id=${itemId}`, TAG);
  return null;
}
