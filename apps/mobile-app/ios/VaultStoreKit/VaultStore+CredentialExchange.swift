import Foundation
import RustCoreFramework

/**
 * The vault as a FIDO Credential Exchange Format document, built by the Rust core.
 */
extension VaultStore {
    /// The identifier and name the export names AliasVault with.
    public static let credentialExchangeExporterRpId = "net.aliasvault.app"
    public static let credentialExchangeExporterDisplayName = "AliasVault"

    /// The personal manifest of the open vault as the core's `ExportResult` JSON (CXF document and counts).
    public func exportCredentialExchange() throws -> String {
        guard let manifestId = getPersonalManifestId() else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "The personal manifest is not known yet"])
        }
        let username = getUsername().flatMap { $0.isEmpty ? nil : $0 } ?? Self.credentialExchangeExporterDisplayName
        let options: [String: Any] = [
            "exporterRpId": Self.credentialExchangeExporterRpId,
            "exporterDisplayName": Self.credentialExchangeExporterDisplayName,
            "accountUsername": username,
            "manifestIds": [manifestId]
        ]
        let optionsJson = String(decoding: try JSONSerialization.data(withJSONObject: options), as: UTF8.self)
        return try requireDatabase().credentialExchangeExport(optionsJson: optionsJson)
    }
}
