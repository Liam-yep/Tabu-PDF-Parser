import initMondayClient from "monday-sdk-js";
import logger from "./logger/index.js";
import { accountConfig } from '../helpers/config/account-config.js';


const TAG = 'getFileInfo';

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
      throw new Error('No file value found in the column');
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
    console.log("send_notification", user_id, itemId, text)
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


export const change_source_column = async (token, itemId, accountId) => {
  logger.debug("change_source_column starts", TAG);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { source_column_id, boardId} = units;

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
      columnId: source_column_id,
      value: JSON.stringify({ label: "נסח טאבו" })
    };

    logger.debug("📤 Sending status update mutation", TAG, { mutation, variables });

    const response = await mondayClient.api(mutation, { variables });
    logger.info("✅ Status column updated successfully", TAG, response);
  } catch (err) {
    logger.error("❌ Error in change_source_column", TAG, err);
  }
};


export const send_failed_status = async (token, itemId, accountId) => {
  logger.debug("send_failed_status starts", TAG);

  const config = accountConfig[accountId];
  if (!config) {
    throw new Error(`No config found for account ${accountId}`);
  }
  const { units } = config;
  const { trigger_column_id, boardId} = units;

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
      columnId: trigger_column_id,
      value: JSON.stringify({ label: "נכשל" })
    };

    logger.debug("Sending send_failed_status", TAG, { mutation, variables });

    const response = await mondayClient.api(mutation, { variables });
    logger.info("✅ Status column updated successfully send_failed_status", TAG, response);
  } catch (err) {
    logger.error("❌ Error in send_failed_status", TAG, err);
  }
};
