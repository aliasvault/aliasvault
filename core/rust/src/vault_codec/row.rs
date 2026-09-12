//! Reading cells out of a row as the platforms hand them over: SQLite booleans arrive as 0/1
//! numbers, JSON booleans or "1"/"true" strings, and a missing table reads as no rows.

use std::collections::HashMap;

use serde_json::Value;

use super::manifest::CodecRecord;
use crate::vault_model::names::IS_DELETED_COL;

/// A cell as a string slice, `None` when absent or not a string.
pub(crate) fn str_col<'a>(row: &'a CodecRecord, column: &str) -> Option<&'a str> {
    row.get(column).and_then(Value::as_str)
}

/// SQLite-tolerant truthiness: boolean true, a non-zero number, or a "1"/"true" string.
pub(crate) fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// True when the row's `IsDeleted` flag is set.
pub(crate) fn is_deleted(row: &CodecRecord) -> bool {
    truthy(row.get(IS_DELETED_COL))
}

/// The rows of `table`, empty when the table set does not carry it.
pub(crate) fn rows_of<'a>(tables: &'a HashMap<String, Vec<CodecRecord>>, table: &str) -> &'a [CodecRecord] {
    tables.get(table).map(Vec::as_slice).unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthy_accepts_every_spelling_sqlite_hands_over() {
        for value in [json!(true), json!(1), json!(1.0), json!(2), json!("1"), json!("true"), json!("TRUE")] {
            assert!(truthy(Some(&value)), "{value} should be truthy");
        }
        for value in [json!(false), json!(0), json!(0.0), json!("0"), json!(""), json!("false"), json!(null)] {
            assert!(!truthy(Some(&value)), "{value} should be falsy");
        }
        assert!(!truthy(None));
    }
}
