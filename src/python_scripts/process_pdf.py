import os
import sys
import asyncio
import aiohttp
from monday_client import get_file_info
from file_utils import download_file
from pdf_to_table.pdf_parser import main as process_pdf_file
from upload_to_monday.subunits import send_subunits_to_monday
from upload_to_monday.owners import send_owners_to_monday

async def main():
    if len(sys.argv) != 4:
        print("Usage: python3 process_pdf.py <token> <item_id> <column_id>")
        return

    token = sys.argv[1]
    item_id = sys.argv[2]
    column_id = sys.argv[3]

    async with aiohttp.ClientSession() as session:
        try:
            file_url, file_name = await get_file_info(session, token, item_id, column_id)
            pdf_path = await download_file(session, file_url, file_name)
            if not pdf_path:
                print("[ERROR] Failed to download file")
                return

            print(f"[INFO] Running parser on file {pdf_path}")
            unit_number, df_units, df_owners = process_pdf_file(pdf_path)

            try:
                os.remove(pdf_path)
                print(f"[INFO] Deleted file {pdf_path}")
            except Exception as e:
                print(f"[WARNING] Failed to delete file: {e}")

            subunit_id_map = await send_subunits_to_monday(session, token, df_units, item_id, unit_number)
            print("[INFO] Subunits sent to Monday.com")

            await send_owners_to_monday(session, token, df_owners, subunit_id_map)

        except Exception as e:
            print(f"[ERROR] {e}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())

