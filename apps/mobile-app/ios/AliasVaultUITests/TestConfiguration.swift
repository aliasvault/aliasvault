import Foundation

/// Configuration for E2E tests
enum TestConfiguration {
    /// API URL for testing (defaults to local development server)
    static var apiUrl: String {
        return ProcessInfo.processInfo.environment["API_URL"] ?? "http://localhost:5092"
    }

    /// Generate a unique name for test items
    static func generateUniqueName(prefix: String = "E2E Test") -> String {
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        return "\(prefix) \(timestamp)"
    }

    /// Default timeout for element waiting (seconds)
    static let defaultTimeout: TimeInterval = 10

    /// Extended timeout for operations that may take longer (like login with network)
    static let extendedTimeout: TimeInterval = 30

    /// Short timeout for quick checks
    static let shortTimeout: TimeInterval = 2
}
