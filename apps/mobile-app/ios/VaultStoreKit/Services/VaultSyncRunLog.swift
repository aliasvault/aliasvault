import Foundation
import VaultUtils

/// The log of one sync engine run for local performance analysis.
internal final class VaultSyncRunLog {
    private static let slowCommandMs = 50.0
    private static let keptSyncs = 5
    private static let maxEntries = 20
    private static let auxiliaryOperations: Set<String> = ["statusCheck", "migrationStatus", "resolveVaultKey"]
    private static let persistLock = NSLock()

    /// Milliseconds since `date`.
    static func elapsedMs(since date: Date) -> Int {
        return Int(Date().timeIntervalSince(date) * 1000)
    }

    /// The persisted run logs as JSON text, newest first.
    static func persistedLogs(in userDefaults: UserDefaults) -> String {
        return userDefaults.string(forKey: VaultConstants.syncLogsKey) ?? "[]"
    }

    /// The size of a text payload (JSON or base64) for the logs, by UTF-8 byte count.
    private static func formatSize(_ value: Any?) -> String {
        let size = (value as? String)?.utf8.count ?? 0
        if size < 1024 {
            return "\(size) B"
        }
        if size < 1024 * 1024 {
            return String(format: "%.1f KB", Double(size) / 1024)
        }
        return String(format: "%.1f MB", Double(size) / (1024 * 1024))
    }

    private let operation: String
    private let startedAt = Date()
    private var lines: [String] = []
    private var commandTimings: [String: (count: Int, totalMs: Double)] = [:]
    private var engineMs = 0.0
    private var jsonMs = 0.0
    private var lastLineMs = 0

    init(operation: String) {
        self.operation = operation
    }

    /// Print a driver line and keep it.
    func note(_ message: String) {
        print("[VaultSync] \(keep(message))")
    }

    /// Print a line the Rust engine emitted and keep it; `phase` and `warn` lines keep their level in the text.
    func engineLine(level: String, message: String) {
        print("[VaultSyncEngine] \(keep(level == "log" ? message : "[\(level)] \(message)"))")
    }

    /// Keep a line, prefixed with its offset from the run start and the time since the previous line. The engine logs
    /// before and after each heavy step (decrypt, canonicalize, merge, materialize, compress), so that gap is the step's time.
    private func keep(_ text: String) -> String {
        let offsetMs = Self.elapsedMs(since: startedAt)
        let line = "+\(offsetMs)ms (Δ\(offsetMs - lastLineMs)ms) \(text)"
        lastLineMs = offsetMs
        lines.append(line)
        return line
    }

    /// Run `body`, counting its time as time inside the Rust engine.
    func engine<T>(_ body: () throws -> T) rethrows -> T {
        let bodyStartedAt = Date()
        defer { engineMs += Date().timeIntervalSince(bodyStartedAt) * 1000 }
        return try body()
    }

    /// Run `body`, counting its time as native JSON parsing and serialization.
    func json<T>(_ body: () throws -> T) rethrows -> T {
        let bodyStartedAt = Date()
        defer { jsonMs += Date().timeIntervalSince(bodyStartedAt) * 1000 }
        return try body()
    }

    /// Count one handled command, and log it on its own when it is a transfer or slow.
    func recordCommand(_ kind: String, command: [String: Any], response: [String: Any], since commandStartedAt: Date) {
        let durationMs = Date().timeIntervalSince(commandStartedAt) * 1000
        let timing = commandTimings[kind] ?? (count: 0, totalMs: 0)
        commandTimings[kind] = (count: timing.count + 1, totalMs: timing.totalMs + durationMs)
        if let line = describe(kind: kind, command: command, response: response, durationMs: durationMs) {
            note(line)
        }
    }

    /// Log where the run's time went and persist the run.
    func finish(result: [String: Any]?, userDefaults: UserDefaults) {
        let totalMs = Self.elapsedMs(since: startedAt)
        let hostMs = commandTimings.values.reduce(0) { $0 + $1.totalMs }
        let parts = commandTimings.sorted { $0.value.totalMs > $1.value.totalMs }.map { "\($0.key) \($0.value.count)x \(Int($0.value.totalMs))ms" }
        note("\(operation) took \(totalMs)ms: engine \(Int(engineMs))ms, host \(Int(hostMs))ms (\(parts.joined(separator: ", "))), json \(Int(jsonMs))ms")

        let entry: [String: Any] = [
            "operation": operation,
            "startedAt": Int(startedAt.timeIntervalSince1970 * 1000),
            "durationMs": totalMs,
            "success": result?["success"] ?? NSNull(),
            "lines": lines
        ]
        persist(entry, in: userDefaults)
    }

    /// One line for a command relevant for performance analysis, or nil for unrelated calls.
    private func describe(kind: String, command: [String: Any], response: [String: Any], durationMs: Double) -> String? {
        let took = "\(kind) took \(Int(durationMs))ms"
        if let error = response["error"] as? String {
            return "\(took): failed (\(error))"
        }
        let slow = durationMs >= Self.slowCommandMs
        let database = command["db"] as? String ?? ""
        switch kind {
        case "http":
            let request = "\(command["method"] as? String ?? "GET") \(command["path"] as? String ?? "")"
            guard let status = response["status"] as? Int, status != 0 else {
                return "\(took): \(request) failed (\(response["transportError"] as? String ?? "no response"))"
            }
            return "\(took): \(request) \(status), sent \(Self.formatSize(command["body"])), received \(Self.formatSize(response["body"]))"
        case "vaultStore":
            return "\(took): \(Self.formatSize(command["encryptedBlob"]))"
        case "vaultLoad":
            return "\(took): \(Self.formatSize(response["encryptedBlob"]))"
        case "dbOpen":
            return "\(took): \(command["bytes"] is String ? Self.formatSize(command["bytes"]) : "fresh schema")"
        case "dbExport":
            return "\(took): \(database) \(Self.formatSize(response["bytes"]))"
        case "dbExec":
            return slow ? "\(took): \((command["statements"] as? [Any])?.count ?? 0) statement(s) on \(database)" : nil
        case "dbQuery":
            return slow ? "\(took): \((response["rows"] as? [Any])?.count ?? 0) row(s) from \(database)" : nil
        default:
            return slow ? took : nil
        }
    }

    /// Prepend the run to the persisted log, keeping the last `keptSyncs` syncs.
    private func persist(_ entry: [String: Any], in userDefaults: UserDefaults) {
        Self.persistLock.lock()
        defer { Self.persistLock.unlock() }

        var existing: [[String: Any]] = []
        if let json = userDefaults.string(forKey: VaultConstants.syncLogsKey), let data = json.data(using: .utf8) {
            existing = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        }

        var kept = [entry]
        var syncs = Self.auxiliaryOperations.contains(operation) ? 0 : 1
        for previous in existing {
            if syncs >= Self.keptSyncs || kept.count >= Self.maxEntries {
                break
            }
            kept.append(previous)
            if !Self.auxiliaryOperations.contains(previous["operation"] as? String ?? "") {
                syncs += 1
            }
        }

        guard JSONSerialization.isValidJSONObject(kept), let data = try? JSONSerialization.data(withJSONObject: kept), let json = String(data: data, encoding: .utf8) else {
            print("[VaultSync] Failed to persist the sync log")
            return
        }
        userDefaults.set(json, forKey: VaultConstants.syncLogsKey)
    }
}
