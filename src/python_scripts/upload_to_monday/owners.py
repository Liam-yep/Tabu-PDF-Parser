import json
from upload_to_monday.subunits import parse_percentage_value

async def send_owners_to_monday(session, token, df_owners, subunit_id_map):
    headers = {
        "Authorization": token,
        "Content-Type": "application/json"
    }

    board_id = 1965912135  # טבלת הבעלים
    column_map = {
        "תעודת זהות": "text_mkr4jcrv",
        "אחוז אחזקה בתת החלקה": "numeric_mkr4ytb2",
        "תת חלקה": "board_relation_mkr4hh21"
    }

    for _, row in df_owners.iterrows():
        subunit_id = str(row["תת חלקה"]).strip()
        subunit_item_id = subunit_id_map.get(subunit_id)

        if not subunit_item_id:
            print(f"⚠️ לא נמצא item_id לתת חלקה {subunit_id} — דילוג")
            continue

        item_name = row["שם בעלים"].strip()

        column_values = {
            column_map["תעודת זהות"]: row["תעודת זהות"].strip(),
            column_map["אחוז אחזקה בתת החלקה"]: parse_percentage_value(row["אחוז אחזקה בתת החלקה"]),
            column_map["תת חלקה"]: {"item_ids": [int(subunit_item_id)]}
        }

        column_values_str = json.dumps(column_values).replace('"', '\\"')

        query = {
            "query": f"""
            mutation {{
                create_item (
                    board_id: {board_id},
                    item_name: "{item_name}",
                    column_values: "{column_values_str}",
                    create_labels_if_missing: true
                ) {{
                    id
                }}
            }}
            """
        }

        async with session.post("https://api.monday.com/v2", headers=headers, json=query) as response:
            res = await response.json()
            if 'errors' in res:
                print(f"❌ Failed to create owner {item_name}: {res['errors']}")
            else:
                print(f"✅ Created owner item: {item_name}")
