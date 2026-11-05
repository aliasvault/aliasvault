import Foundation
import VaultUtils

/// Legacy conversion of the stored vault file from base64 text to raw bytes.
///
/// 0.31.1 and older stored the encrypted vault as base64 text in `legacyBase64EncryptedDbFileName`; newer builds store the
/// raw bytes in `encryptedDbFileName`. The first read after an update converts the old file once.
///
/// Other platform implementations: LegacyVaultFileConversion.kt (Android).
///
/// TODO: remove once all clients have upgraded past 0.31.1. An install that still holds only
/// the old file then has no vault and logs in again.
extension VaultStore {
    /// The vault file as base64 text, as 0.31.1 and older stored it.
    static let legacyBase64EncryptedDbFileName = "encrypted_db.sqlite"

    /// Convert the base64 vault file into the raw bytes file at `path`, when only the base64 file exists.
    internal func convertLegacyBase64Database(to path: URL) {
        let fileManager = FileManager.default
        let legacyPath = sharedContainerURL().appendingPathComponent(Self.legacyBase64EncryptedDbFileName)
        guard !fileManager.fileExists(atPath: path.path), fileManager.fileExists(atPath: legacyPath.path) else { return }
        guard let text = try? Data(contentsOf: legacyPath) else { return }
        if let bytes = Data(base64Encoded: text, options: .ignoreUnknownCharacters) {
            // Moved into place only when no file exists yet, so a vault the app or the autofill extension stored meanwhile wins.
            let tempPath = sharedContainerURL().appendingPathComponent(UUID().uuidString)
            if (try? bytes.write(to: tempPath)) != nil, (try? fileManager.moveItem(at: tempPath, to: path)) == nil {
                try? fileManager.removeItem(at: tempPath)
            }
            // A failed write keeps the old file, so the next read tries again.
            guard fileManager.fileExists(atPath: path.path) else { return }
        } else {
            print("[VaultStore] The legacy base64 vault file does not decode; dropping it")
        }
        try? fileManager.removeItem(at: legacyPath)
    }
}
