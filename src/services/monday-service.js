import initMondayClient from "monday-sdk-js";
import logger from "./logger/index.js";
import { accountConfig } from '../helpers/config/account-config.js';


const TAG = 'monday-service';

export const getFileInfo = async (token, itemId, columnId) => {
  logger.debug('Started getFileInfo', TAG);
  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion('2024-07');
    mondayClient.setToken(token);

    const query = `
      query ($itemId: [ID!]) {
        items(ids: $itemId) {
          column_values(ids: ["${columnId}"]) {
            value
          }
          assets {
            id
            name
            public_url
            file_extension
          }
        }
      }
    `;

    const variables = { itemId };
    const response = await mondayClient.api(query, { variables });

    const item = response.data?.items?.[0];
    if (!item) {
      throw new Error('Item not found');
    }

    const valueStr = item.column_values?.[0]?.value;
    if (!valueStr) {
      throw new Error('No file found in the column');
    }

    const value = JSON.parse(valueStr);
    const assetId = String(value.files?.[0]?.assetId);
    if (!assetId) {
      throw new Error('Asset ID not found in column value');
    }

    const asset = item.assets.find(a => a.id === assetId);
    if (!asset) {
      throw new Error('Asset not found in item assets');
    }

    return {
      file_url: asset.public_url,
      file_name: asset.name,
    };

  } catch (err) {
    logger.error('Error getFileInfo', TAG, err);
    throw err;
  }
};


export const send_notification = async (token, user_id, itemId, text) => {
    console.log("send_notification")
    try {
      const mondayClient = initMondayClient();
      mondayClient.setApiVersion('2024-07');
      mondayClient.setToken(token);

      const notification_query = `mutation 
        CreateNotification($user_id: ID!, $itemId: ID!, $text: String!) {
        create_notification (user_id: $user_id, target_id: $itemId, text: $text, target_type: Project) {
          text
        }
      }`;
      const variables = {user_id, itemId, text};
      const response = await mondayClient.api(notification_query, { variables })
      return response;
  } catch (err) {
    logger.error('Error send_notification', TAG, err);
  }
};


export const delete_all_subunits_before = async (token, itemId, accountId) => {
  logger.debug("delete_all_subunits_before starts", TAG)
  
  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { connect_to_subunits_column_id } = units
  
  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion('2024-10');
    mondayClient.setToken(token);

    const query = `
      query ($itemId: [ID!]) {
        items(ids: $itemId) {
          column_values(ids:["${connect_to_subunits_column_id}"]) {
            ... on BoardRelationValue {
              linked_items{
                name
                id
              }
            }
          }
        }
      }`;
      
    const variables = { itemId };
    const response = await mondayClient.api(query, { variables });
    const linkedItems = response?.data?.items?.[0]?.column_values?.[0]?.linked_items || [];
    logger.info(`Found ${linkedItems.length} linked items to delete`, TAG);
    for (const item of linkedItems) {
        try {
          logger.debug(`🗑 Deleting item: ${item.name} (${item.id})`, TAG);

          const deleteMutation = `
          mutation ($itemId: ID!) {
            delete_item(item_id: $itemId) {
              id
            }
          }`;

        const variables = { itemId: parseInt(item.id) };
        const response = await mondayClient.api(deleteMutation, { variables });

        logger.info(`✅ Deleted item ${item.id}`, TAG);
        } catch (err) {
          logger.error(`❌ Failed to delete item ${item.id}`, TAG, err);
        }
      }

  } catch (err) {
    logger.error('❌ Error in delete_all_subunits_before', TAG, err);
  }
};


export const change_units_columns = async (token, itemId, accountId, unitNumber, blockNumber) => {
  logger.debug("change_units_columns starts", TAG);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { boardId, source_column_id, unit_column_id, block_column_id} = units;

  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion('2024-07');
    mondayClient.setToken(token);

    const mutation = `
      mutation ChangeMultiple($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `;

    const columnValues = {
      [source_column_id]: { label: "נסח טאבו" },
      [unit_column_id]: unitNumber.toString(),     // מומלץ כטקסט – תואם לעמודת טקסט/מספר
      [block_column_id]: blockNumber.toString()    // כנ"ל
    };

    const variables = {
      boardId: boardId,
      itemId: itemId.toString(),
      columnValues: JSON.stringify(columnValues)
    };

    // logger.debug("📤 Sending change_units_columns", TAG, { mutation, variables });

    const response = await mondayClient.api(mutation, { variables });
    logger.info("✅ Status column updated successfully", TAG, response);
  } catch (err) {
    logger.error("❌ Error in change_units_columns", TAG, err);
  }
};


export const send_failed_status = async (token, itemId, accountId, status) => {
  logger.debug("send_failed_status starts", TAG);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { failed_status_column_id, boardId} = units;

  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion('2024-07');
    mondayClient.setToken(token);

    const mutation = `
      mutation ChangeStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
          id
        }
      }
    `;

    const variables = {
      boardId: boardId,
      itemId: itemId.toString(), // חשוב שיהיה מחרוזת (ID ולא Int)
      columnId: failed_status_column_id,
      value: JSON.stringify({ label: status })
    };

    logger.debug("Sending send_failed_status", TAG, { mutation, variables });

    const response = await mondayClient.api(mutation, { variables });
    logger.info("✅ Status column updated successfully send_failed_status", TAG, response);
  } catch (err) {
    logger.error("❌ Error in send_failed_status", TAG, err);
  }
};


export const send_technical_notes = async ({
  token,
  itemId,
  accountId,
  processPdfFileFailedOwners = [],
  processPdfFileFaileSubunits = [],
  failedOwners = [],
  failedSubunits = [],
  error_reason = null
}) => {
  logger.debug("send_technical_notes starts", TAG, {
    "processPdfFileFailedOwners":processPdfFileFailedOwners,
    "processPdfFileFaileSubunits":processPdfFileFaileSubunits,
    "failedOwners":failedOwners,
    "failedSubunits":failedSubunits,
    "error_reason":error_reason
  });

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }

  const { units } = config;
  const { boardId, technical_errors_column_id } = units;

  const errors = [];
  
  if (error_reason) errors.push(error_reason);

  if (processPdfFileFaileSubunits.length > 0) {
    errors.push("❗ שגיאות בקריאת תתי־חלקות מה-PDF:");
    errors.push(...processPdfFileFaileSubunits.map(e => `• ${e}`));
  }

  if (processPdfFileFailedOwners.length > 0) {
    errors.push("❗ שגיאות בזיהוי בעלים-PDF:");
    errors.push(...processPdfFileFailedOwners.map(e => `• ${e}`));
  }

  if (failedSubunits.length > 0) {
    errors.push("❗ שגיאות בהעלאת תתי־חלקות:");
    errors.push(...failedSubunits.map(e => `• ${e}`));
  }

  if (failedOwners.length > 0) {
    errors.push("❗ שגיאות בהעלאת בעלים:");
    errors.push(...failedOwners.map(e => `• ${e}`));
  }

  if (errors.length === 0) {
    logger.info("✅ אין שגיאות בתהליך. הכל עלה בהצלחה.", TAG);
    return;
  }
  const fullMessage = errors.join('\n');

  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion("2024-07");
    mondayClient.setToken(token);

    const mutation = `
      mutation ChangeText($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value
        ) {
          id
        }
      }
    `;

    const variables = {
    boardId: boardId,
    itemId: itemId.toString(),
    columnId: technical_errors_column_id,
    value: JSON.stringify({ text: fullMessage })
  };
  
    const response = await mondayClient.api(mutation, { variables });
    logger.info("✅ Technical notes updated successfully", TAG, response);

     if (error_reason){
      await send_failed_status(token, itemId, accountId, "נכשל")
    }
    else if (processPdfFileFaileSubunits.length > 0 || processPdfFileFailedOwners.length > 0 || failedSubunits.length > 0 || failedOwners.length > 0) {
      await send_failed_status(token, itemId, accountId, "הועלה חלקית")
    }
    
  } catch (err) {
    logger.error("❌ Error in send_technical_notes", TAG, err);
  }
};


export const get_existing_subunits = async (token, itemId, accountId) => {
  logger.debug("get_existing_subunits starts", TAG)

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { connect_to_subunits_column_id } = units

  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion('2024-10');
    mondayClient.setToken(token);

    const query = `
      query ($itemId: [ID!]) {
        items(ids: $itemId) {
          column_values(ids:["${connect_to_subunits_column_id}"]) {
            ... on BoardRelationValue {
              linked_items{
                id
                name
              }
            }
          }
        }
      }`;

    const variables = { itemId };
    const response = await mondayClient.api(query, { variables });
    const linkedItems = response?.data?.items?.[0]?.column_values?.[0]?.linked_items || [];
    
    // logger.info(`📦 Found ${linkedItems.length} linked subunits`, TAG);
    return linkedItems;

  } catch (err) {
    logger.error('❌ Error in get_existing_subunits', TAG, err);
    return [];
  }
};


export const get_existing_owners = async (token, subunitItemIds, accountId) => {
  const TAG = "get_existing_owners";
  const config = accountConfig[accountId];
  if (!config) throw new Error(`No config found for account ${accountId}`);

  const { subunits, owners } = config;
  const ownersRelationCol = subunits.columnMap["דיירים"];
  const { columnMap: ownerCols } = owners;

  try {
    const mondayClient = initMondayClient();
    mondayClient.setApiVersion("2024-10");
    mondayClient.setToken(token);

    // --- batching helper ---
    const batch = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
      }
      return out;
    };

    const batches = batch(subunitItemIds, 25); // Monday limit

    let allSubunits = [];

    for (const group of batches) {
      const query = `
        query ($ids: [ID!]) {
          items(ids: $ids) {
            id
            name
            column_values(ids: ["${ownersRelationCol}"]) {
              ... on BoardRelationValue {
                linked_items {
                  id
                  name
                  column_values(ids: ["${ownerCols["תעודת זהות"]}", "${ownerCols["פירוט הבעלות"]}"]) {
                    id
                    text
                  }
                }
              }
            }
          }
        }
      `;

      const response = await mondayClient.api(query, { variables: { ids: group } });

      const data = response?.data?.items || [];
      allSubunits.push(...data);
    }

    console.log(`Fetched ${allSubunits.length} subunits (after batching)`);

    const ownersList = allSubunits.flatMap(su =>
      (su?.column_values?.[0]?.linked_items || []).map(owner => ({
        id: owner.id,
        name: owner.name,
        subunitId: su.id,
        subunitName: su.name,
        nationalId: owner.column_values.find(cv => cv.id === ownerCols["תעודת זהות"])?.text || "",
        ownershipType: owner.column_values.find(cv => cv.id === ownerCols["פירוט הבעלות"])?.text || ""
      }))
    );

    console.log(`Collected ${ownersList.length} owners`);

    return ownersList;

  } catch (err) {
    logger.error("❌ Error in get_existing_owners", TAG, err);
    return [];
  }
};


