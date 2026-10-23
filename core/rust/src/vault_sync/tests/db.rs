use crate::vault_sync::db::*;

#[test]
fn ids_are_lowercase_uuid_v4() {
    let id = new_id();
    assert_eq!(id.len(), 36);
    assert_eq!(id, id.to_lowercase());
    assert_eq!(&id[14..15], "4");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
}
