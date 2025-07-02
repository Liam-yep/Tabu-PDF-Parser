import fs from 'fs/promises';
import logger from '../services/logger/index.js';
import { getFileInfo } from '../services/monday-service.js';
import { downloadFile } from '../services/file-service.js';
import { processPdfFile } from '../services/pdf_parser.js'
import { sendSubunitsToMonday } from '../services/monday-upload-subunits.js';
import { sendOwnersToMonday } from '../services/monday-upload-owners.js';

const TAG = 'monday-controller';

export async function sendPdf(req, res) {
  try {
    console.log('sendPdf called');
    const { shortLivedToken } = req.session;
    const { inputFields } = req.body.payload;
    const { itemId, PDFColumnId } = inputFields;
    console.log("PDFColumnId",PDFColumnId, "itemId", itemId);

    const { file_url, file_name } = await getFileInfo(shortLivedToken, itemId, PDFColumnId);
    console.log('File URL:', file_url, 'File Name:', file_name);

    const filePath = await downloadFile(file_url, file_name);
    if (!filePath) {
      console.error("Failed to download file");
      return res.status(400).send({"severityCode" : 4000,
        "notificationErrorTitle" : "Failed to download file",
        "notificationErrorDescription" : "Failed to download file",
        "runtimeErrorDescription" : `Failed to download file`});
    }

    console.log("📥 File saved to:", filePath);
    
    const { unitNumber, subunitData, ownersData } = await processPdfFile(filePath);
    console.log("PDF parsed successfully");
    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.warn(`Failed to delete file: ${err}`);
    }

    console.log("Sending subunits to Monday...");
    const { subunitIdMap, failedSubunits } = await sendSubunitsToMonday(shortLivedToken, subunitData, itemId, unitNumber);
    if (failedSubunits.length > 0) {
      logger.warn("sendPdf", TAG, `Some subunits failed to upload: ${failedSubunits.join(', ')}`);
    }

    console.log("Sending owners to Monday...");
    const failedOwners = await sendOwnersToMonday(shortLivedToken, ownersData, subunitIdMap);
    console.log("Owners sent finished");
    if (failedOwners.length > 0) {
      logger.warn("sendPdf", TAG, `Some owners failed to upload: ${failedOwners.join(', ')}`);
    }
    console.log("returning 200");
    return res.status(200).send()
  } catch (err) {
    console.error("sendPdf", TAG, {"error":err});
    return res.status(400).send({"severityCode" : 4000,
        "notificationErrorTitle" : "internal server error",
        "notificationErrorDescription" : "internal server error - Tabu PDF Parser",
        "runtimeErrorDescription" : `internal server error`});
  }
}


