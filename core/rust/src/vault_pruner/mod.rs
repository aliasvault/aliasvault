//! Vault pruner for automatically removing expired trash items.
//!
//! This module handles the automatic cleanup of items that have been in the trash
//! (DeletedAt set) for longer than the retention period (default 30 days).
//! It generates SQL statements to permanently delete (IsDeleted = true) these items
//! along with their related entities.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::VaultResult;
use crate::vault_merge::SqlStatement;

/// A record is a map of column names to JSON values.
pub type Record = HashMap<String, serde_json::Value>;

/// Data for a single table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    /// Table name
    pub name: String,
    /// All records in this table
    pub records: Vec<Record>,
}

/// Input for the prune operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneInput {
    /// Tables from the local database (at minimum, Items table is required)
    pub tables: Vec<TableData>,
    /// Current time in ISO 8601 format with UTC timezone.
    ///
    /// **Required format**: `YYYY-MM-DDTHH:MM:SS.sssZ`
    ///
    /// Examples:
    /// - `"2024-01-15T10:30:00.000Z"`
    /// - `"2025-12-24T21:33:30.674Z"`
    ///
    /// Callers should use:
    /// - JavaScript: `new Date().toISOString()`
    /// - C#: `DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")`
    /// - Swift: `ISO8601DateFormatter().string(from: Date())`
    /// - Kotlin: `Instant.now().toString()` or `SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())`
    pub current_time: String,
    /// Retention period in days (default: 30)
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
}

fn default_retention_days() -> u32 {
    30
}

/// Statistics about what was pruned.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PruneStats {
    /// Number of items permanently deleted
    pub items_pruned: u32,
    /// Number of field values permanently deleted
    pub field_values_pruned: u32,
    /// Number of attachments permanently deleted
    pub attachments_pruned: u32,
    /// Number of TOTP codes permanently deleted
    pub totp_codes_pruned: u32,
    /// Number of passkeys permanently deleted
    pub passkeys_pruned: u32,
}

/// Output of the prune operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneOutput {
    /// Whether the prune was successful
    pub success: bool,
    /// SQL statements to execute on the local database (in order)
    pub statements: Vec<SqlStatement>,
    /// Statistics about what was pruned
    pub stats: PruneStats,
}

/// Main entry point: prune expired items from trash.
///
/// This function finds all Items with DeletedAt set that are older than
/// retention_days and generates SQL statements to mark them and their
/// related entities as permanently deleted (IsDeleted = true).
///
/// # Arguments
/// * `input` - PruneInput containing table data, retention period, and current time
///
/// # Returns
/// PruneOutput with SQL statements to execute on local database
pub fn prune_vault(input: PruneInput) -> VaultResult<PruneOutput> {
    let mut stats = PruneStats::default();
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Parse current time from input (required from caller)
    let now = parse_datetime(&input.current_time)
        .ok_or_else(|| crate::error::VaultError::General(
            format!("Invalid current_time format: {}", input.current_time)
        ))?;

    // Calculate cutoff date
    let cutoff_date = now - Duration::days(input.retention_days as i64);

    // Find Items table
    let items_table = input.tables.iter().find(|t| t.name == "Items");
    if items_table.is_none() {
        return Ok(PruneOutput {
            success: true,
            statements: vec![],
            stats,
        });
    }

    let items = &items_table.unwrap().records;

    // Find items that are in trash (DeletedAt set) and older than retention period
    let mut expired_item_ids: Vec<String> = Vec::new();

    for item in items {
        // Skip if already permanently deleted
        if let Some(is_deleted) = item.get("IsDeleted") {
            if is_deleted.as_i64() == Some(1) || is_deleted.as_bool() == Some(true) {
                continue;
            }
        }

        // Check if item is in trash (DeletedAt is set and not null)
        if let Some(deleted_at) = item.get("DeletedAt") {
            if deleted_at.is_null() {
                continue;
            }

            if let Some(deleted_at_str) = deleted_at.as_str() {
                if let Some(deleted_date) = parse_datetime(deleted_at_str) {
                    if deleted_date < cutoff_date {
                        if let Some(id) = item.get("Id").and_then(|v| v.as_str()) {
                            expired_item_ids.push(id.to_string());
                        }
                    }
                }
            }
        }
    }

    // If no expired items, return early
    if expired_item_ids.is_empty() {
        return Ok(PruneOutput {
            success: true,
            statements: vec![],
            stats,
        });
    }

    // Generate SQL statements to permanently delete the expired items and related entities
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    for item_id in &expired_item_ids {
        // Mark item as permanently deleted
        statements.push(SqlStatement {
            sql: "UPDATE Items SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?".to_string(),
            params: vec![
                serde_json::json!(now_str),
                serde_json::json!(item_id),
            ],
        });
        stats.items_pruned += 1;

        // Mark related FieldValues as deleted
        if let Some(field_values_table) = input.tables.iter().find(|t| t.name == "FieldValues") {
            let related_count = count_related_records(&field_values_table.records, "ItemId", item_id);
            if related_count > 0 {
                statements.push(SqlStatement {
                    sql: "UPDATE FieldValues SET IsDeleted = 1, UpdatedAt = ? WHERE ItemId = ? AND IsDeleted = 0".to_string(),
                    params: vec![
                        serde_json::json!(now_str),
                        serde_json::json!(item_id),
                    ],
                });
                stats.field_values_pruned += related_count;
            }
        }

        // Mark related Attachments as deleted
        if let Some(attachments_table) = input.tables.iter().find(|t| t.name == "Attachments") {
            let related_count = count_related_records(&attachments_table.records, "ItemId", item_id);
            if related_count > 0 {
                statements.push(SqlStatement {
                    sql: "UPDATE Attachments SET IsDeleted = 1, UpdatedAt = ? WHERE ItemId = ? AND IsDeleted = 0".to_string(),
                    params: vec![
                        serde_json::json!(now_str),
                        serde_json::json!(item_id),
                    ],
                });
                stats.attachments_pruned += related_count;
            }
        }

        // Mark related TotpCodes as deleted
        if let Some(totp_table) = input.tables.iter().find(|t| t.name == "TotpCodes") {
            let related_count = count_related_records(&totp_table.records, "ItemId", item_id);
            if related_count > 0 {
                statements.push(SqlStatement {
                    sql: "UPDATE TotpCodes SET IsDeleted = 1, UpdatedAt = ? WHERE ItemId = ? AND IsDeleted = 0".to_string(),
                    params: vec![
                        serde_json::json!(now_str),
                        serde_json::json!(item_id),
                    ],
                });
                stats.totp_codes_pruned += related_count;
            }
        }

        // Mark related Passkeys as deleted
        if let Some(passkeys_table) = input.tables.iter().find(|t| t.name == "Passkeys") {
            let related_count = count_related_records(&passkeys_table.records, "ItemId", item_id);
            if related_count > 0 {
                statements.push(SqlStatement {
                    sql: "UPDATE Passkeys SET IsDeleted = 1, UpdatedAt = ? WHERE ItemId = ? AND IsDeleted = 0".to_string(),
                    params: vec![
                        serde_json::json!(now_str),
                        serde_json::json!(item_id),
                    ],
                });
                stats.passkeys_pruned += related_count;
            }
        }
    }

    Ok(PruneOutput {
        success: true,
        statements,
        stats,
    })
}

/// Prune vault using JSON strings.
/// Convenience function for FFI.
pub fn prune_vault_json(input_json: &str) -> VaultResult<String> {
    let input: PruneInput = serde_json::from_str(input_json)?;
    let output = prune_vault(input)?;
    let output_json = serde_json::to_string(&output)?;
    Ok(output_json)
}

/// Parse a datetime string in various formats.
/// Handles both RFC3339 format (2025-12-11T06:50:10.674Z) and
/// SQLite format (2025-12-11 06:50:10.674).
fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    // Try RFC3339 first
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            // Try SQLite format: "YYYY-MM-DD HH:MM:SS.mmm"
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
                .ok()
                .map(|naive| naive.and_utc())
        })
}

/// Count related records that match a foreign key value and are not already deleted.
fn count_related_records(records: &[Record], fk_column: &str, fk_value: &str) -> u32 {
    records.iter().filter(|r| {
        // Check if FK matches
        let fk_matches = r.get(fk_column)
            .and_then(|v| v.as_str())
            .map(|v| v == fk_value)
            .unwrap_or(false);

        // Check if not already deleted
        let not_deleted = match r.get("IsDeleted") {
            Some(v) => v.as_i64() != Some(1) && v.as_bool() != Some(true),
            None => true,
        };

        fk_matches && not_deleted
    }).count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_item_record(id: &str, deleted_at: Option<&str>, is_deleted: bool) -> Record {
        let mut record = HashMap::new();
        record.insert("Id".to_string(), serde_json::json!(id));
        record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
        record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
        if let Some(dt) = deleted_at {
            record.insert("DeletedAt".to_string(), serde_json::json!(dt));
        } else {
            record.insert("DeletedAt".to_string(), serde_json::Value::Null);
        }
        record
    }

    fn make_field_value_record(id: &str, item_id: &str, is_deleted: bool) -> Record {
        let mut record = HashMap::new();
        record.insert("Id".to_string(), serde_json::json!(id));
        record.insert("ItemId".to_string(), serde_json::json!(item_id));
        record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
        record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
        record
    }

    #[test]
    fn test_prune_expired_items() {
        let now = Utc::now();
        let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        // Create an item deleted 60 days ago
        let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        let input = PruneInput {
            tables: vec![
                TableData {
                    name: "Items".to_string(),
                    records: vec![make_item_record("item-1", Some(&old_date), false)],
                },
                TableData {
                    name: "FieldValues".to_string(),
                    records: vec![make_field_value_record("fv-1", "item-1", false)],
                },
            ],
            retention_days: 30,
            current_time: now_str,
        };

        let output = prune_vault(input).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.items_pruned, 1);
        assert_eq!(output.stats.field_values_pruned, 1);
        assert!(output.statements.len() >= 2); // At least item + field value updates
    }

    #[test]
    fn test_no_prune_recent_items() {
        let now = Utc::now();
        let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        // Create an item deleted 10 days ago (within retention)
        let recent_date = (now - Duration::days(10)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        let input = PruneInput {
            tables: vec![
                TableData {
                    name: "Items".to_string(),
                    records: vec![make_item_record("item-1", Some(&recent_date), false)],
                },
            ],
            retention_days: 30,
            current_time: now_str,
        };

        let output = prune_vault(input).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.items_pruned, 0);
        assert!(output.statements.is_empty());
    }

    #[test]
    fn test_no_prune_active_items() {
        let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        // Create an item that's not in trash (DeletedAt is null)
        let input = PruneInput {
            tables: vec![
                TableData {
                    name: "Items".to_string(),
                    records: vec![make_item_record("item-1", None, false)],
                },
            ],
            retention_days: 30,
            current_time: now_str,
        };

        let output = prune_vault(input).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.items_pruned, 0);
        assert!(output.statements.is_empty());
    }

    #[test]
    fn test_no_prune_already_deleted() {
        let now = Utc::now();
        let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        // Create an item that's already permanently deleted
        let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        let input = PruneInput {
            tables: vec![
                TableData {
                    name: "Items".to_string(),
                    records: vec![make_item_record("item-1", Some(&old_date), true)],
                },
            ],
            retention_days: 30,
            current_time: now_str,
        };

        let output = prune_vault(input).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.items_pruned, 0);
        assert!(output.statements.is_empty());
    }

    #[test]
    fn test_prune_json_api() {
        let now = Utc::now();
        let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        let input_json = format!(r#"{{
            "tables": [{{
                "name": "Items",
                "records": [{{
                    "Id": "item-1",
                    "UpdatedAt": "2024-01-01T00:00:00Z",
                    "IsDeleted": 0,
                    "DeletedAt": "{}"
                }}]
            }}],
            "retention_days": 30,
            "current_time": "{}"
        }}"#, old_date, now_str);

        let output_json = prune_vault_json(&input_json).unwrap();
        let output: PruneOutput = serde_json::from_str(&output_json).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.items_pruned, 1);
    }
}
