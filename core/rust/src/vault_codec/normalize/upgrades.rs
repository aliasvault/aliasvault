//! Temporary: upgrades of rows older clients wrote to the current shape.

use super::Tables;
use crate::vault_codec::row::{has_bytes, inline_bytes, str_col};
use crate::vault_model::names::{ID_COL, PASSKEYS_TABLE};

/// The WebAuthn credential id column of `Passkeys`.
const CREDENTIAL_ID_COL: &str = "CredentialId";

/// LEGACY: give every `Passkeys` row without a `CredentialId` (as clients before 0.32.0 create them) the 16 GUID bytes
/// of its `Id`, the credential id its relying party received. TODO: remove once pre-0.32.0 clients are no longer supported.
pub(super) fn fill_missing_credential_ids(tables: &mut Tables) {
    let Some(rows) = tables.get_mut(PASSKEYS_TABLE) else { return };
    for row in rows.iter_mut().filter(|row| !has_bytes(row.get(CREDENTIAL_ID_COL))) {
        let Some(bytes) = str_col(row, ID_COL).and_then(|id| crate::passkey::guid_to_bytes(id).ok()) else { continue };
        row.insert(CREDENTIAL_ID_COL.to_string(), inline_bytes(&bytes));
    }
}
