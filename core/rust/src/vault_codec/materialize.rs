//! Materialize the canonical persisted representation as a concrete SQLite projection.
//!
//! `materialize_as_sqlite` is the SQLite adapter of the materialize direction. SQLite is one possible
//! projection of the canonical dataset, not an authoritative destination. Future targets would add
//! sibling `materialize_as_*` entry points. The inverse direction lives in `canonicalize`.
//!
//! Rust does not handle actual SQLite operations. It only emits the destination table rows as-is
//! to the caller and let the caller handle the actual SQLite database creation and data insertion.

use super::manifest::{MaterializeInput, MaterializedTables, CodecTableData};
use super::types::is_skip_table;
use crate::error::VaultResult;

/// Materialize the manifest + its data buckets into the table set the platform inserts.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    let MaterializeInput { manifest, data_buckets } = input;

    let mut tables: Vec<CodecTableData> = Vec::with_capacity(manifest.tables.len() + data_buckets.len());

    for (name, records) in manifest.tables {
        if is_skip_table(&name) {
            continue;
        }
        tables.push(CodecTableData { name, records });
    }

    // Reconstitute every data bucket's tables back into the flat set.
    for bucket in data_buckets {
        for (name, records) in bucket.tables {
            if is_skip_table(&name) {
                continue;
            }
            tables.push(CodecTableData { name, records });
        }
    }

    Ok(MaterializedTables {
        tables,
        migration_id: manifest.migration_id,
    })
}
