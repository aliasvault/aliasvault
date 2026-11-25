//! The FIDO Credential Exchange Format (CXF 1.0) which allows password manager apps to hand credentials to each other.
//! This module builds the export document; an incoming import is read in TypeScript instead (`core/client/src/transfer/import/importers/cxf`).

mod export;

#[cfg(test)]
mod tests;

pub use export::{export_document, ExportOptions, ExportResult};
