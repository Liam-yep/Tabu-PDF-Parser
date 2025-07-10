export const accountConfig = {
    "27435948": {
        account_name: "Katagroup",
        subunits:{
            boardId: 1923677090,
            columnMap: {    
            "החלק ברכוש המשותף": "numeric_mkq62m7k",
            "תיאור קומה": "color_mkq6ytpj",
            "שטח במר": "numeric_mks1ka3t",
            "משכנתה": "color_mkr56hf9",
            "קשר לחלקה": "board_relation_mkq7xz0x"
            },
            source_column_id: "color_mkskq78k"
        },
        owners:{
            boardId: 1965912135,
            columnMap: {    
                "תעודת זהות": "text_mkr4jcrv",
                "אחוז אחזקה בתת החלקה": "numeric_mkr4ytb2",
                "תת חלקה": "board_relation_mkr4hh21",
                "סוג זיהוי": "dropdown_mksk4a30",
            },
            source_column_id: "color_mksfnhrz"
        },
        units:{
            boardId: 1923674628,
            connect_to_subunits_column_id : "board_relation_mkq6pa0w", // חיבור לתתי חלקות
            source_column_id : "color_mkske7b0", // עמודת מקור
            trigger_column_id: "color_mks7nkf3", // טריגר נסח טאבו
            block_column_id: "text_mkrj72wg", // גוש
            unit_column_id: "name", // חלקה(מזין לשם האייטם)
            technical_errors_column_id: "long_text_mksk5948", // טכני -פירוט שגיאה
        }
    },  

    "28210172": {
        account_name: "Gabay Group",
        subunits:{
            boardId: 1994898626,
            columnMap: {
            "החלק ברכוש המשותף": "numeric_mkrv7f4",
            "תיאור קומה": "color_mkskcnxs",
            "שטח במר": "numeric_mks97j9f",
            "משכנתה": "color_mkskvqnx",
            "קשר לחלקה": "board_relation_mkrrdeat"
            },
            source_column_id: "color_mksmmvwd"
        },
        owners:{
            boardId: 1994905239,
            columnMap: {    
                "תעודת זהות": "text_mkrryxqe",
                "אחוז אחזקה בתת החלקה": "numeric_mkrvmj4s",
                "תת חלקה": "board_relation_mkrrs48y",
                "סוג זיהוי": "dropdown_mksmatqm",
            },
            source_column_id: "color_mksm1nm5"
        },
        units:{
            boardId: 1995160277,
            connect_to_subunits_column_id : "board_relation_mkrrqqmn",
            source_column_id : "color_mksmt2gv",
            trigger_column_id: "color_mksfxcwe", // טריגר נסח טאבו
            block_column_id: "text_mksq9npq", // גוש
            unit_column_id: "text_mksq8b5t", // חלקה(לעמודה ולא לשם האייטם)
            technical_errors_column_id: "long_text_mksk2a5y", // טכני -פירוט שגיאה
        }  
    }
}

