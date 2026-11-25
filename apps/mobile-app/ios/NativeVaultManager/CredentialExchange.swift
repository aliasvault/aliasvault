import AuthenticationServices
import Foundation
import UIKit

/**
 * The iOS side of the FIDO Credential Exchange handshake (iOS 26+): the import token another app's export launched
 * the app with, receiving that export as a CXF document, and handing the vault's CXF document to another app.
 */
enum CredentialExchangeHandoff {
    private static let lock = NSLock()
    private static var pendingToken: UUID?

    /// The deep link that opens the import review screen in React Native.
    static let importUrl = URL(string: "aliasvault://open/credential-exchange-import")!

    /// Keep an incoming credential exchange activity's token; true when the activity was one.
    @discardableResult
    static func handle(_ activity: NSUserActivity) -> Bool {
        guard #available(iOS 26.0, *), activity.activityType == ASCredentialExchangeActivity, let token = activity.userInfo?[ASCredentialImportToken] as? UUID else {
            return false
        }
        lock.lock()
        defer { lock.unlock() }
        pendingToken = token
        return true
    }

    /// Whether a token is waiting to be taken.
    static var hasPending: Bool {
        lock.lock()
        defer { lock.unlock() }
        return pendingToken != nil
    }

    /// Open the import review screen in the running app. Under the scene life cycle React Native only takes links
    /// from a `UIOpenURLContext`, which cannot be created here, so this posts the notification its Linking module observes.
    static func openImportScreen() {
        NotificationCenter.default.post(name: Notification.Name("RCTOpenURLNotification"), object: nil, userInfo: ["url": importUrl.absoluteString])
    }

    /// The stored token, once: a token is only valid for one import call.
    static func take() -> UUID? {
        lock.lock()
        defer { lock.unlock() }
        let token = pendingToken
        pendingToken = nil
        return token
    }
}

@available(iOS 26.0, *)
enum CredentialExchange {
    /// Receive what another app exported under `token`, as a CXF 1.0 document (JSON text) with the header the core expects.
    static func importDocument(token: UUID) async throws -> String {
        let data = try await ASCredentialImportManager().importCredentials(token: token)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(Int(date.timeIntervalSince1970))
        }
        let accounts = try data.accounts.map { account in
            renameSubCollections(try JSONSerialization.jsonObject(with: encoder.encode(account)), from: appleSubCollectionsKey, to: cxfSubCollectionsKey)
        }
        let header: [String: Any] = [
            "version": ["major": 1, "minor": 0],
            "exporterRpId": data.exporterRelyingPartyIdentifier,
            "exporterDisplayName": data.exporterDisplayName,
            "timestamp": Int(data.timestamp.timeIntervalSince1970),
            "accounts": accounts
        ]
        guard let text = String(data: try JSONSerialization.data(withJSONObject: header), encoding: .utf8) else {
            throw invalidDocument("the received data is not UTF-8")
        }
        return text
    }

    /// Hand a CXF document to the app the user picks in the system sheet.
    static func export(document: String, exporterRpId: String, exporterDisplayName: String, anchor: ASPresentationAnchor) async throws {
        let accounts = try decodeAccounts(document)
        let manager = ASCredentialExportManager(presentationAnchor: anchor)
        let options = try await manager.requestExport()
        let data = ASExportedCredentialData(
            accounts: accounts, formatVersion: options.formatVersion, exporterRelyingPartyIdentifier: exporterRpId, exporterDisplayName: exporterDisplayName, timestamp: Date()
        )
        try await manager.exportCredentials(data)
    }

    private static func invalidDocument(_ detail: String) -> NSError {
        NSError(domain: "CredentialExchange", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid credential exchange document: \(detail)"])
    }

    /// CXF names a collection's children `subCollections`; Apple's types read and write `subcollections`.
    private static let cxfSubCollectionsKey = "subCollections"
    private static let appleSubCollectionsKey = "subcollections"

    /// An account with the children key of its collections renamed, at every depth.
    private static func renameSubCollections(_ account: Any, from oldKey: String, to newKey: String) -> Any {
        func renamed(_ collection: Any) -> Any {
            guard var collection = collection as? [String: Any] else {
                return collection
            }
            if let children = collection.removeValue(forKey: oldKey) as? [Any] {
                collection[newKey] = children.map(renamed)
            }
            return collection
        }
        guard var account = account as? [String: Any], let collections = account["collections"] as? [Any] else {
            return account
        }
        account["collections"] = collections.map(renamed)
        return account
    }

    /// The accounts of a CXF document as Apple's types, which decode CXF JSON with unix-seconds dates.
    private static func decodeAccounts(_ document: String) throws -> [ASImportableAccount] {
        guard let bytes = document.data(using: .utf8), let root = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let accounts = root["accounts"] as? [Any] else {
            throw invalidDocument("no accounts")
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try accounts.map { account in
            let renamed = renameSubCollections(account, from: cxfSubCollectionsKey, to: appleSubCollectionsKey)
            return try decoder.decode(ASImportableAccount.self, from: try JSONSerialization.data(withJSONObject: renamed))
        }
    }
}
