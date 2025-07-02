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

    logger.debug('Found asset in column', TAG, {
      file_url: asset.public_url,
      file_name: asset.name,
    });

    return {
      file_url: asset.public_url,
      file_name: asset.name,
    };

  } catch (err) {
    logger.error('Error getFileInfo', TAG, err);
    throw err;
  }
};
