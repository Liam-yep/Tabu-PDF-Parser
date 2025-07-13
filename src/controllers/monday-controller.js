import fs from 'fs/promises';
import logger from '../services/logger/index.js';
import { getFileInfo, send_notification, delete_all_subunits_before, change_units_columns, send_failed_status, send_technical_notes } from '../services/monday-service.js';
import { downloadFile } from '../services/file-service.js';
import { processPdfFile } from '../services/pdf_parser.js'
import { sendSubunitsToMonday } from '../services/monday-upload-subunits.js';
import { sendOwnersToMonday } from '../services/monday-upload-owners.js';
import { ConnectionModelService } from '../services/model-services/connection-model-service.js';


const TAG = 'monday-controller';
const connectionModelService = new ConnectionModelService();


export async function sendPdf(req, res) {
  let shortLivedToken, userId, accountId, itemId, connection, token;
  try {
    console.log('sendPdf called');
    res.status(200).send()
    
    shortLivedToken = req.session.shortLivedToken;
    userId = req.session.userId;
    accountId = req.session.accountId;
    itemId = req.body.payload.inputFields.itemId;

    console.log("accountId",accountId)
    connection = await connectionModelService.getConnectionByUserId(accountId);
    logger.debug("connection from connectionModelService", TAG, {"connection":connection})
    token = connection?.mondayToken

    const { inputFields } = req.body.payload;
    const { PDFColumnId } = inputFields;
    console.log("PDFColumnId",PDFColumnId, "itemId", itemId);
    const { file_url, file_name } = await getFileInfo(token, itemId, PDFColumnId);
    console.log('File URL:', file_url, 'File Name:', file_name);

    const filePath = await downloadFile(file_url, file_name);
    if (!filePath) {
      error_reason = "Failed to download file"
      console.error(error_reason);
      await send_notification(token, userId, itemId, error_reason)
      await send_failed_status(token, itemId, accountId)
      await send_technical_notes({token, itemId, accountId, error_reason})
      return;
    }


    console.log("📥 File saved to:", filePath);
    
    const { unitNumber, blockNumber, subunitData, ownersData, processPdfFileFailedOwners, processPdfFileFaileSubunits } = await processPdfFile(filePath);
    console.log("PDF parsed successfully");
    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.warn(`Failed to delete file: ${err}`);
    }
    await delete_all_subunits_before(token, itemId, accountId)
    await change_units_columns(token, itemId, accountId, unitNumber, blockNumber)
    console.log("Sending subunits to Monday...");
    
    const { subunitIdMap, failedSubunits } = await sendSubunitsToMonday(token, subunitData, itemId, unitNumber, accountId);
    if (failedSubunits.length > 0) {
      logger.warn("sendPdf", TAG, `Some subunits failed to upload: ${failedSubunits.join(', ')}`);
    }

    console.log("Sending owners to Monday...");
    const failedOwners = await sendOwnersToMonday(token, ownersData, subunitIdMap, accountId);
    console.log("Owners sent finished");
    if (failedOwners.length > 0) {
      logger.warn("sendPdf", TAG, `Some owners failed to upload: ${failedOwners.join(', ')}`);
    }
    await send_technical_notes({token, itemId, accountId, processPdfFileFailedOwners, processPdfFileFaileSubunits, failedOwners, failedSubunits});
    console.log("returning 200");
    return
  } catch (err) {
    console.error("sendPdf", TAG, {"error":err});
    const error_reason = "internal server error - Tabu PDF Parser"
    await send_notification(token, userId, itemId, error_reason)
    console.log("accountIdaccountIdaccountIdaccountId",accountId)
    await send_failed_status(token, itemId, accountId)
    await send_technical_notes({token, itemId, accountId, error_reason})
    return 
  }
}


