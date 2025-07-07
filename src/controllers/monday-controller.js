import fs from 'fs/promises';
import logger from '../services/logger/index.js';
import { getFileInfo, send_notification, delete_all_subunits_before, change_source_column } from '../services/monday-service.js';
import { downloadFile } from '../services/file-service.js';
import { processPdfFile } from '../services/pdf_parser.js'
import { sendSubunitsToMonday } from '../services/monday-upload-subunits.js';
import { sendOwnersToMonday } from '../services/monday-upload-owners.js';

const TAG = 'monday-controller';

export async function sendPdf(req, res) {
  let shortLivedToken, userId, accountId, itemId;
  try {
    console.log('sendPdf called');
    res.status(200).send()
    shortLivedToken = req.session.shortLivedToken;
    userId = req.session.userId;
    accountId = req.session.accountId;
    itemId = req.body.payload.inputFields.itemId;

    const { inputFields } = req.body.payload;
    const { PDFColumnId } = inputFields;
    console.log("PDFColumnId",PDFColumnId, "itemId", itemId);

    const { file_url, file_name } = await getFileInfo(shortLivedToken, itemId, PDFColumnId);
    console.log('File URL:', file_url, 'File Name:', file_name);

    const filePath = await downloadFile(file_url, file_name);
    if (!filePath) {
      console.error("Failed to download file");
      await send_notification(shortLivedToken, userId, itemId, "Failed to download file")
      return;
    }


    console.log("📥 File saved to:", filePath);
    
    const { unitNumber, subunitData, ownersData } = await processPdfFile(filePath);
    console.log("PDF parsed successfully");
    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.warn(`Failed to delete file: ${err}`);
    }
    await delete_all_subunits_before(shortLivedToken, itemId, accountId)
    await change_source_column(shortLivedToken, itemId, accountId)
    console.log("Sending subunits to Monday...");
    
    const { subunitIdMap, failedSubunits } = await sendSubunitsToMonday(shortLivedToken, subunitData, itemId, unitNumber, accountId);
    if (failedSubunits.length > 0) {
      logger.warn("sendPdf", TAG, `Some subunits failed to upload: ${failedSubunits.join(', ')}`);
    }

    console.log("Sending owners to Monday...");
    const failedOwners = await sendOwnersToMonday(shortLivedToken, ownersData, subunitIdMap, accountId);
    console.log("Owners sent finished");
    if (failedOwners.length > 0) {
      logger.warn("sendPdf", TAG, `Some owners failed to upload: ${failedOwners.join(', ')}`);
    }
    console.log("returning 200");
    return
  } catch (err) {
    console.error("sendPdf", TAG, {"error":err});
    await send_notification(shortLivedToken, userId, itemId, "internal server error - Tabu PDF Parser")
    return 
  }
}


