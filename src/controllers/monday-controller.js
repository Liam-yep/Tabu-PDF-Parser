import fs from 'fs/promises';
import logger from '../services/logger/index.js';
import { getFileInfo, send_notification, delete_all_subunits_before, change_units_columns, send_technical_notes } from '../services/monday-service.js';
import { downloadFile } from '../services/file-service.js';
import { processPdfFile } from '../services/pdf_parser.js'
import { sendSubunitsToMonday, syncSubunits } from '../services/monday-upload-subunits.js';
import { sendOwnersToMonday } from '../services/monday-upload-owners.js';
import { ConnectionModelService } from '../services/model-services/connection-model-service.js';
import { enqueueByAccount } from '../services/accountQueue.js';
import { get_existing_subunits } from '../services/monday-service.js';
import { prepareSubunitsForSync } from '../services/diff-utils.js';
import { get_existing_owners } from '../services/monday-service.js';
import { prepareOwnersForSync } from '../services/diff-utils.js';
import { mergeDuplicateOwners } from '../services/utils.js';
import { syncOwners } from '../services/monday-upload-owners.js';


const TAG = 'monday-controller';
const connectionModelService = new ConnectionModelService();


export async function sendPdf(userId, accountId, itemId, inputFields) {
  console.log('sendPdf called');
  let connection, token, filePath, error_reason;
  
  try {  
    console.log("accountId",accountId)
    connection = await connectionModelService.getConnectionByUserId(accountId);
    // logger.debug("connection from connectionModelService", TAG, {"connection":connection})
    token = connection?.mondayToken

    const { PDFColumnId } = inputFields;
    console.log("PDFColumnId",PDFColumnId, "itemId", itemId);
    try {
      const { file_url, file_name } = await getFileInfo(token, itemId, PDFColumnId);
      filePath = await downloadFile(file_url, file_name);

      if (!filePath) {
        const error_reason = "Failed to download file";
        await send_notification(token, userId, itemId, error_reason);
        await send_technical_notes({token, itemId, accountId, error_reason});
        return;
      }
    } catch (err) {
      console.error("Error downloading file:", err);
      const error_reason = err.message || "Unknown error in files";
      await send_notification(token, userId, itemId, error_reason);
      await send_technical_notes({token, itemId, accountId, error_reason});
      return;
    }

    console.log("📥 File saved to:", filePath);
    
    const { unitNumber, blockNumber, subunitData, ownersData, processPdfFileFailedOwners, processPdfFileFaileSubunits } = await processPdfFile(filePath);
    גדש
    if (!unitNumber){
      error_reason = "Invalid file. Please upload a valid PDF Tabu document."
      console.error(error_reason);
      await send_notification(token, userId, itemId, error_reason)
      await send_technical_notes({token, itemId, accountId, error_reason})
      return;
    }
    console.log("PDF parsed successfully");
    // await delete_all_subunits_before(token, itemId, accountId)
    const existingSubunits = await get_existing_subunits(token, itemId, accountId);

    const markedSubunits = prepareSubunitsForSync(existingSubunits, subunitData, unitNumber);
    // console.log("markedSubunits", markedSubunits);
    
    await change_units_columns(token, itemId, accountId, unitNumber, blockNumber)
    console.log("Sending subunits to Monday...");
    
    // const { subunitIdMap, failedSubunits } = await sendSubunitsToMonday(token, subunitData, itemId, unitNumber, accountId);
    const { subunitIdMap, failedSubunits } = await syncSubunits(token, markedSubunits, itemId, unitNumber, accountId);
    // console.log("Subunits sent finished", subunitIdMap);
    
    if (failedSubunits.length > 0) {
      logger.warn("sendPdf", TAG, `Some subunits failed to upload: ${failedSubunits.join(', ')}`);
    }

    const existingOwners = await get_existing_owners(token, Object.values(subunitIdMap), accountId);
    // console.log("existingOwners", existingOwners);

    const mergedOwners = mergeDuplicateOwners(ownersData, subunitIdMap);
    // console.log("mergedOwners", mergedOwners);
    
    const markedOwners = prepareOwnersForSync(existingOwners, mergedOwners, subunitIdMap);
    // console.log("markedOwners", markedOwners);

    console.log("Sending owners to Monday...");
    // const failedOwners = await sendOwnersToMonday(token, ownersData, subunitIdMap, accountId);
    const failedOwners = await syncOwners(token, markedOwners, subunitIdMap, accountId);

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
