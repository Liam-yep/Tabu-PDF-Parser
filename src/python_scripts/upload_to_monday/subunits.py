from fractions import Fraction
import json

async def send_subunits_to_monday(session, token, df_units, parent_item_id, unit_number):
    headers = {
        "Authorization": token,
        "Content-Type": "application/json"
    }

    subunit_id_map = {}
    board_id = 1923677090  # טבלת תתי חלקות
    column_map = {
        "החלק ברכוש המשותף": "numeric_mkq62m7k",
        "תיאור קומה": "dropdown_mkv6bxn2",
        "שטח במר": "numeric_mks1ka3t",
        "משכנתה": "color_mkr56hf9",
        "קשר לחלקה": "board_relation_mkq7xz0x"
    }

    for _, row in df_units.iterrows():
        subunit_id = str(row["תת חלקה"]).strip()
        item_name = f"{unit_number} - {subunit_id}"

        column_values = {
            column_map["החלק ברכוש המשותף"]: parse_percentage_value(row["החלק ברכוש המשותף"]),
            column_map["תיאור קומה"]: {"label": row["תיאור קומה"]},
            column_map["שטח במר"]: float(row["שטח במר"]),
            column_map["משכנתה"]: {"label": row["משכנתה"]},
            column_map["קשר לחלקה"]: {"item_ids": [int(parent_item_id)]}
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
                print(f"❌ Failed to create item for {item_name}: {res['errors']}")
            else:
                item_id = res['data']['create_item']['id']
                subunit_id_map[subunit_id] = item_id
                print(f"✅ Created item: {item_name} (ID: {item_id})")
    
    return subunit_id_map


def parse_percentage_value(value):
    value = value.strip().replace(" ", "")
    
    if value == "בשלמות":
        return 100.0

    try:
        if '/' in value:
            return float(Fraction(value)) * 100
        else:
            return float(value)
    except Exception:
        print(f"⚠️ לא ניתן לפרש את ערך האחוז: '{value}'")
        return 0.0