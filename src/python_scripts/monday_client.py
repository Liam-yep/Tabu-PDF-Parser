import json
import asyncio
from aiohttp import ClientError, ClientConnectionError

MONDAY_API_URL = "https://api.monday.com/v2"

async def get_file_info(session, token, item_id, column_id):
    headers = {
        "Authorization": token,
        "Content-Type": "application/json"
    }

    query = {
        "query": f"""
        query {{
            items (ids: {item_id}) {{
                column_values(ids: ["{column_id}"]) {{
                    value
                }}
                assets {{
                    id
                    name
                    public_url
                    file_extension
                }}
            }}
        }}
        """
    }

    retry_delay = 5
    for attempt in range(5):
        try:
            async with session.post(MONDAY_API_URL, headers=headers, json=query) as response:
                if response.status in [429, 500]:
                    print(f"⏳ Retry {attempt+1}: Waiting {retry_delay}s")
                    await asyncio.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 60)
                    continue

                res = await response.json()
                data = res["data"]["items"][0]

                # נשלוף assetId מהעמודה
                value_str = data["column_values"][0]["value"]
                if not value_str:
                    raise Exception("No file in the column.")

                value_json = json.loads(value_str)
                asset_id = str(value_json["files"][0]["assetId"])

                # נחפש את ה־asset הזה מתוך רשימת ה־assets של האייטם
                for asset in data["assets"]:
                    if asset["id"] == asset_id:
                        return asset["public_url"], asset["name"]

                raise Exception("Asset not found in item assets list.")

        except (asyncio.TimeoutError, ClientError, ClientConnectionError) as e:
            print(f"❌ API Error on attempt {attempt + 1}: {e}")
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

    raise Exception("Failed to retrieve file info after retries.")



