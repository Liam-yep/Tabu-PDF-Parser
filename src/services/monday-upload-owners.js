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
      // [columnMap["תעודת זהות"]]: String(row["תעודת זהות"]).trim(),
      // [columnMap["אחוז אחזקה בתת החלקה"]]: parsePercentage(row["אחוז אחזקה בתת החלקה"]),
      [columnMap["אחוז אחזקה בתת החלקה"]]: row["אחוז אחזקה בתת החלקה"],
      [columnMap["תת חלקה"]]: { item_ids: [parseInt(subunitItemId)] },
      [source_column_id]: { label: "נסח טאבו" },
      // [columnMap["סוג זיהוי"]]: { labels: [String(row["סוג זיהוי"]).trim()] },
      [columnMap["פירוט הבעלות"]]: { labels: [String(row["פירוט הבעלות"]).trim()] },
    };

    if (row["תעודת זהות"]) {
      columnValues[columnMap["תעודת זהות"]] = String(row["תעודת זהות"]).trim();
    }

    if (row["סוג זיהוי"]) {
      columnValues[columnMap["סוג זיהוי"]] = { labels: [String(row["סוג זיהוי"]).trim()] };
    }

    if (columnMap["סוג בעלות"]) {
      columnValues[columnMap["סוג בעלות"]] = { label: String(row["סוג בעלות"]).trim() }; // Status
    }


    let attempt = 0;
    let success = false;
    let response;

    while (attempt < 3 && !success) {
      try {
        attempt++;
        const mutation = `
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
        `
        response = await mondayClient.api(mutation);
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
      let nameAndSubUnit = `דייר - ${itemName} תת חלקה - ${subunitId}`;
      logger.error("sendOwnersToMonday", TAG, { "Failed permanently after 3 attempts": nameAndSubUnit });
      if (response?.errors?.[0]?.extensions?.status_code === 500) {
        nameAndSubUnit = `שגיאה פנימית ב Monday. אפשר לנסות שוב מאוחר יותר. ${nameAndSubUnit}`;
      }
      failedOwners.push(nameAndSubUnit);
    }
  }
  return failedOwners;
}


export async function syncOwners(token, markedOwners, subunitIdMap, accountId) {
  const failedOwners = [];

  for (const owner of markedOwners) {
    try {
      if (owner.action === "create") {
        const itemId = await createOwner(token, owner, subunitIdMap, accountId);
        if (itemId) {
          owner.id = itemId; // שמירה גם אצלנו
        }
      } else if (owner.action === "update") {
        await updateOwner(token, owner.id, owner, subunitIdMap, accountId);
      } else if (owner.action === "delete") {
        await deleteOwner(token, owner.id);
      }
    } catch (err) {
      logger.error(`❌ Failed to ${owner.action} owner ${owner["שם בעלים"]}`, "syncOwners", err);
      failedOwners.push(owner["שם בעלים"]);
    }
  }

  return { failedOwners };
}


export async function createOwner(token, row, subunitIdMap, accountId) {
  const TAG = "createOwner";

  const mondayClient = initMondayClient();
  mondayClient.setApiVersion("2024-07");
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) throw new Error(`No config found for account ${accountId}`);
  const { owners } = config;
  const { boardId, columnMap, source_column_id } = owners;

  const subunitId = String(row["תת חלקה"]).trim();
  const subunitItemId = subunitIdMap[subunitId];
  const itemName = String(row["שם בעלים"]).trim();

  if (!subunitItemId) {
    logger.warn(`⚠️ createOwner: לא נמצא subunitItemId לתת חלקה ${subunitId}`, TAG);
    return null;
  }

  let columnValues = {
    // [columnMap["תעודת זהות"]]: String(row["תעודת זהות"] || "").trim(),
    [columnMap["אחוז אחזקה בתת החלקה"]]: row["אחוז אחזקה בתת החלקה"],
    [columnMap["תת חלקה"]]: { item_ids: [parseInt(subunitItemId)] },
    [source_column_id]: { label: "נסח טאבו" },
    // [columnMap["סוג זיהוי"]]: { labels: [String(row["סוג זיהוי"] || "").trim()] },
    // [columnMap["פירוט הבעלות"]]: { labels: [String(row["פירוט הבעלות"] || "").trim()] },
  };

  if (row["פירוט הבעלות"] && row["פירוט הבעלות"].labels) {
    columnValues[columnMap["פירוט הבעלות"]] = {
      labels: row["פירוט הבעלות"].labels.map(l => String(l).trim())
    };
  }


  if (row["תעודת זהות"]) {
    columnValues[columnMap["תעודת זהות"]] = String(row["תעודת זהות"]).trim();
  }

  if (row["סוג זיהוי"]) {
    columnValues[columnMap["סוג זיהוי"]] = { labels: [String(row["סוג זיהוי"]).trim()] };
  }

  if (columnMap["סוג בעלות"]) {
    columnValues[columnMap["סוג בעלות"]] = { label: String(row["סוג בעלות"] || "").trim() };
  }

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
        // logger.info(`✅ Created owner ${itemName} (id=${itemId})`, TAG);
        success = true;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to create owner: ${itemName}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error creating owner ${itemName}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  if (!success) {
    logger.error(`❌ Failed permanently to create owner: ${itemName}`, TAG);
  }

  return itemId;
}


export async function updateOwner(token, itemId, row, subunitIdMap, accountId) {
  const TAG = "updateOwner";

  const mondayClient = initMondayClient();
  mondayClient.setApiVersion("2024-07");
  mondayClient.setToken(token);

  const config = accountConfig[accountId];
  if (!config) throw new Error(`No config found for account ${accountId}`);
  const { owners } = config;
  const { boardId, columnMap, source_column_id } = owners;

  const subunitId = String(row["תת חלקה"]).trim();
  const subunitItemId = subunitIdMap[subunitId];

  let columnValues = {
    // [columnMap["תעודת זהות"]]: String(row["תעודת זהות"] || "").trim(),
    [columnMap["אחוז אחזקה בתת החלקה"]]: row["אחוז אחזקה בתת החלקה"],
    [columnMap["תת חלקה"]]: { item_ids: [parseInt(subunitItemId)] },
    [source_column_id]: { label: "נסח טאבו" },
    // [columnMap["סוג זיהוי"]]: { labels: [String(row["סוג זיהוי"] || "").trim()] },
    // [columnMap["פירוט הבעלות"]]: { labels: [String(row["פירוט הבעלות"] || "").trim()] },
  };

  if (row["פירוט הבעלות"] && row["פירוט הבעלות"].labels) {
    columnValues[columnMap["פירוט הבעלות"]] = {
      labels: row["פירוט הבעלות"].labels.map(l => String(l).trim())
    };
}

  if (row["תעודת זהות"]) {
    columnValues[columnMap["תעודת זהות"]] = String(row["תעודת זהות"]).trim();
  }

  if (row["סוג זיהוי"]) {
    columnValues[columnMap["סוג זיהוי"]] = { labels: [String(row["סוג זיהוי"]).trim()] };
  }

  if (columnMap["סוג בעלות"]) {
    columnValues[columnMap["סוג בעלות"]] = { label: String(row["סוג בעלות"] || "").trim() };
  }

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
            column_values: ${JSON.stringify(JSON.stringify(columnValues))}
          ) { id }
        }
      `);

      const updatedId = response?.data?.change_multiple_column_values?.id;
      if (updatedId) {
        // logger.info(`✅ Updated owner (id=${itemId})`, TAG);
        success = true;
        return updatedId;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to update owner id=${itemId}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error updating owner id=${itemId}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  logger.error(`❌ Failed permanently to update owner id=${itemId}`, TAG);
  return null;
}


export async function deleteOwner(token, itemId) {
  const TAG = "deleteOwner";

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
          delete_item (item_id: ${itemId}) { id }
        }
      `);

      const deletedId = response?.data?.delete_item?.id;
      if (deletedId) {
        // logger.info(`✅ Deleted owner (id=${itemId})`, TAG);
        success = true;
        return deletedId;
      } else {
        logger.error(`❌ Attempt ${attempt} failed to delete owner id=${itemId}`, TAG, response?.errors);
      }
    } catch (err) {
      logger.error(`❌ Attempt ${attempt} – Error deleting owner id=${itemId}`, TAG, err);
    }

    if (!success && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 5 * attempt));
    }
  }

  logger.error(`❌ Failed permanently to delete owner id=${itemId}`, TAG);
  return null;
}
