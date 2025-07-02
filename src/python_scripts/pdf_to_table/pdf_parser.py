import pdfplumber
import pandas as pd
import re
import os

def remove_parentheses(text):
    return re.sub(r"[()]", " ", text)


def parse_owner_line(line):
    owner = {
        "תת חלקה": None,
        "שם בעלים": None,
        "תעודת זהות": None,
        "אחוז אחזקה בתת החלקה": None
    }
    
    match = re.search(r"(רכמ|םכסה יפ לע השורי|השורי|הרומת אלל רכמ|םש יונש|רפוס תועט ןוקית|האווצ|ףתושמ תיב םושיר|ףדוע)", line)
    if match:   
        # owner["סוג עסקה"] = match.group(1)[::-1]
        line = line.replace(match.group(1), "")
    line = line.replace(" / ","/")

    parts = line.split("ז.ת")
    if len(parts) != 2:
        print("⚠️ לא זוהתה תבנית 'ז.ת' תקינה בשורה:", line)
        return None

    owner["שם בעלים"] = remove_parentheses(parts[1]).strip()[::-1]

    part_one_split = parts[0].strip().split()

    if len(part_one_split) < 2:
        print("⚠️ פורמט לא תקני בשורת בעלים:", line)
        return None
    
    owner["תעודת זהות"] = part_one_split[-1]
    ownership_share = part_one_split[-2]
    if re.search(r'[\u0590-\u05FF]', ownership_share):
                ownership_share = ownership_share[::-1]
    owner["אחוז אחזקה בתת החלקה"] = ownership_share

    return owner


def extract_owners(block_lines, subunit_id):

    owners = []
    for i, line in enumerate(block_lines):
        
        line = line.strip()
        if "תויולעב" in line:
            while i + 1 < len(block_lines):
                
                curr_line = block_lines[i + 1].strip()
                if not re.search(r"(רכמ|םכסה יפ לע השורי|השורי|הרומת אלל רכמ|םש יונש|רפוס תועט ןוקית|האווצ|ףתושמ תיב םושיר|ףדוע|ז.ת|פ.ח)", curr_line):
                    break

                owner = parse_owner_line(curr_line)
                owner["תת חלקה"] = subunit_id
                owners.append(owner)
            
                i+=1

    return owners


def extract_subunit_data(lines, subunit_id):

    is_mortgage = any("התנכשמ" in l for l in lines)

    for i, line in enumerate(lines):

        if "חטש" in line and "ר\"מב" in line and i + 1 < len(lines):
            data_line = lines[i + 1].strip().replace(" / ","/")
            parts = data_line.split()
            part_in_common = parts[0]
            unit_area = parts[-1]
            floor = parts[-2]

            if re.search(r'[\u0590-\u05FF]', floor):
                floor = floor[::-1]
        
            return [{
                "תת חלקה": subunit_id,
                "החלק ברכוש המשותף": part_in_common,
                "תיאור קומה": floor,
                'שטח במר': unit_area,
                "משכנתה": 'קיימת' if is_mortgage else 'לא קיימת'
            }]
        

def extract_subunit_id(lines):
    for line in lines:
        if "הקלח תת" in line:
            match = re.search(r"(\d+)\s+הקלח תת", line)
            if match:
                return match.group(1)
    return None


def parse_subunit_block(block):
    subunit_id = extract_subunit_id(block)
    print(f"Extracted subunit ID: {subunit_id}")

    subunit_data = extract_subunit_data(block, subunit_id)
    owners_data = extract_owners(block, subunit_id)

    if not owners_data:
        print(f"⚠️ לא נמצאו בעלים עבור תת חלקה {subunit_id}")

    return subunit_data, owners_data


def parse_subdivisions(subdivision_blocks):
    all_subunits = []
    all_owners = []

    for block in subdivision_blocks:
        subunit_data, owners_data = parse_subunit_block(block)
        all_subunits.extend(subunit_data)
        all_owners.extend(owners_data)

    return all_subunits, all_owners


def clean_lines_from_header_block(lines):
    
    unit_number_found = False
    j=0
    while not unit_number_found and j < len(lines):
        line = lines[j].strip()
        if "שוג" in line and "הקלח" in line:
            line_parts = line.split()
            unit_number = line_parts[0] if line_parts else None
            unit_number_found = True
        j += 1


    cleaned = []
    i = 0
    while i < len(lines):
        
        line = lines[i].strip()
        if re.match(r"\d+\s+ךותמ\s+\d+\s+דומע", line):
            i += 9  # דלג על 10 שורות (כולל הנוכחית)
            continue
        if line == "םינותנ ףוס":
            break
        cleaned.append(line)
        i += 1
    return cleaned, unit_number


def extract_text_from_pdf(pdf_path):

    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split('\n'))
    return lines


def split_into_sub_units(lines):

    sub_units = []
    current_unit = []
    for line in lines:
        if re.match(r"\d+ הקלח תת", line.strip()):
            if current_unit:
                sub_units.append(current_unit)
            current_unit = [line]
        else:
            if current_unit:
                current_unit.append(line)
    if current_unit:
        sub_units.append(current_unit)
    return sub_units


def extract_text_blocks(pdf_path):
    raw_lines = extract_text_from_pdf(pdf_path)
    cleaned_lines, unit_number = clean_lines_from_header_block(raw_lines)
    sub_units = split_into_sub_units(cleaned_lines)
    return sub_units, unit_number


def export_to_excel(units, owners, pdf_path):
    df_units = pd.DataFrame(units)
    df_owners = pd.DataFrame(owners)

    return df_units, df_owners
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    output_path = os.path.join("results", f"results_{base_name}.xlsx")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    print(f"Exporting results to {output_path}")
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df_units.to_excel(writer, sheet_name="תתי חלקות", index=False)
        df_owners.to_excel(writer, sheet_name="בעלויות", index=False)


def main(pdf_path):
    all_units, unit_number = extract_text_blocks(pdf_path)
    units, owners = parse_subdivisions(all_units)
    df_units, df_owners = export_to_excel(units, owners, pdf_path)
    return unit_number, df_units, df_owners
