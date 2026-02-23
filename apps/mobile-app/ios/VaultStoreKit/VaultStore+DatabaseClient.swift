import Foundation
import SQLite

/// Extension to make VaultStore conform to DatabaseClient protocol.
/// This allows VaultStore to be used with the repository pattern.
extension VaultStore: DatabaseClient {
    /// The ItemRepository instance for this VaultStore.
    public var itemRepository: ItemRepository {
        return ItemRepository(client: self)
    }

    /// The PasskeyRepository instance for this VaultStore.
    public var passkeyRepository: PasskeyRepository {
        return PasskeyRepository(client: self)
    }

    /// The TotpRepository instance for this VaultStore.
    public var totpRepository: TotpRepository {
        return TotpRepository(client: self)
    }
}
