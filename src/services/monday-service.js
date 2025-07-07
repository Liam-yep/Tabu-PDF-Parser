import initMondayClient from "monday-sdk-js";
import logger from "./logger/index.js";

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

