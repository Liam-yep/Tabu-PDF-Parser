import fs from 'fs/promises';
import logger from '../services/logger/index.js';
import { getFileInfo, send_notification, delete_all_subunits_before, change_units_columns, send_technical_notes } from '../services/monday-service.js';
import { downloadFile } from '../services/file-service.js';
import { processPdfFile } from '../services/pdf_parser.js'
import { sendSubunitsToMonday } from '../services/monday-upload-subunits.js';
import { sendOwnersToMonday } from '../services/monday-upload-owners.js';
import { ConnectionModelService } from '../services/model-services/connection-model-service.js';
import { enqueueByAccount } from '../services/accountQueue.js';

const TAG = 'monday-controller';
const connectionModelService = new ConnectionModelService();


export async function sendPdf(userId, accountId, itemId, inputFields) {
  console.log('sendPdf called');
  let connection, token, filePath, error_reason;
  
  try {  
    console.log("accountId",accountId)
    connection = await connectionModelService.getConnectionByUserId(accountId);
    logger.debug("connection from connectionModelService", TAG, {"connection":connection})
    token = connection?.mondayToken

    const { PDFColumnId } = inputFields;
    console.log("PDFColumnId",PDFColumnId, "itemId", itemId);
    const { file_url, file_name } = await getFileInfo(token, itemId, PDFColumnId);
    console.log('File URL:', file_url, 'File Name:', file_name);

    filePath = await downloadFile(file_url, file_name);
    if (!filePath) {
      error_reason = "Failed to download file"
      console.error(error_reason);
      await send_notification(token, userId, itemId, error_reason)
      await send_technical_notes({token, itemId, accountId, error_reason})
      return;
    }


    console.log("📥 File saved to:", filePath);
    
    const { unitNumber, blockNumber, subunitData, ownersData, processPdfFileFailedOwners, processPdfFileFaileSubunits } = await processPdfFile(filePath);
    if (!unitNumber){
      error_reason = "Invalid file. Please upload a valid PDF Tabu document."
      console.error(error_reason);
      await send_notification(token, userId, itemId, error_reason)
      await send_technical_notes({token, itemId, accountId, error_reason})
      return;
    }
    console.log("PDF parsed successfully");
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
    console.log("✅ Finished sendPdf");
    return
  } catch (err) {
    console.error("sendPdf", TAG, {"error":err});
    error_reason = "internal server error - Tabu PDF Parser"
    if (token) {
      await send_notification(token, userId, itemId, error_reason)
      await send_technical_notes({token, itemId, accountId, error_reason})
    }
    return 
  } finally {
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn(`Failed to delete file: ${err}`);
      }
    }
  }
}

export async function enqueue_and_run(req, res) {
  console.log('enqueue_and_run called');
  let shortLivedToken, userId, accountId, itemId;

  shortLivedToken = req.session.shortLivedToken;
  userId = req.session.userId;
  accountId = req.session.accountId;
  itemId = req.body.payload.inputFields.itemId;
  const { inputFields } = req.body.payload;

  res.status(200).send()
  return enqueueByAccount(accountId, async () => {
    await sendPdf(userId, accountId, itemId, inputFields);
  });
}
