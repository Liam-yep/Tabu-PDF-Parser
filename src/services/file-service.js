import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * מוריד קובץ PDF מה-URL ושומר אותו לתוך תקיית downloads
 * @param {string} fileUrl - הקישור לקובץ
 * @param {string} fileName - שם הקובץ לשמירה
 * @returns {Promise<string>} - נתיב הקובץ שנשמר
 */
export async function downloadFile(fileUrl, fileName) {
  try {
    const dir = path.join(process.cwd(), 'downloads');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, fileName);

    const response = await axios.get(fileUrl, { responseType: 'stream' });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`✅ File downloaded: ${fileName}`);
        resolve(filePath);
      });
      writer.on('error', (err) => {
        console.error(`❌ Failed to write file: ${err}`);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`❌ Failed to download file: ${fileName}, Error: ${error}`);
    throw new Error(`Failed to download file. ${error.message}`);
  }
}
