import Foundation

/**
 * DateHelpers
 * -------------------------
 * Centralized utility for formatting Date values consistently across the client application.
 * All dates are stored in UTC with the format: "yyyy-MM-dd HH:mm:ss.fff" (23 characters).
 * This format ensures:
 * - SQLite native support for date functions
 * - No timezone ambiguity (all dates are UTC)
 * - Consistent precision with milliseconds for accurate sorting/comparison
 * - Readable space separator instead of 'T'
 * - Lexicographic sorting works correctly
 */
public class DateHelpers {
    /// Date formatter for a given pattern.
    private static func makeFormatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = pattern
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }

    private static let standardFormatter = makeFormatter("yyyy-MM-dd HH:mm:ss.SSS")
    private static let withoutMillisFormatter = makeFormatter("yyyy-MM-dd HH:mm:ss")
    private static let birthDateFormatter = makeFormatter("yyyy-MM-dd 00:00:00")
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    /// Format a Date to the standard format string: "yyyy-MM-dd HH:mm:ss.SSS" (23 characters).
    public static func toStandardFormat(_ date: Date) -> String {
        return standardFormatter.string(from: date)
    }

    /// Format the current UTC time to the standard format string.
    public static func now() -> String {
        return toStandardFormat(Date())
    }

    /// Format a Date to the birth date format (no milliseconds, time set to 00:00:00).
    /// Format: "yyyy-MM-dd 00:00:00" (19 characters).
    public static func toBirthDateFormat(_ date: Date) -> String {
        return birthDateFormatter.string(from: date)
    }

    /// Parse a date string to a Date object for use in queries.
    /// Supports multiple formats:
    /// - "yyyy-MM-dd HH:mm:ss.SSS" (standard format with milliseconds)
    /// - "yyyy-MM-dd HH:mm:ss" (standard format without milliseconds)
    /// - ISO8601 with fractional seconds and timezone
    public static func parseDateString(_ dateString: String) -> Date? {
        let cleanedDateString = dateString.trimmingCharacters(in: .whitespacesAndNewlines)

        // If ends with 'Z' or contains timezone, attempt ISO8601 parsing
        if cleanedDateString.contains("Z") || cleanedDateString.contains("+") || cleanedDateString.contains("-") {
            if let isoDate = isoFormatter.date(from: cleanedDateString) {
                return isoDate
            }
        }

        // Try parsing with milliseconds
        if let dateWithMillis = standardFormatter.date(from: cleanedDateString) {
            return dateWithMillis
        }

        // Try parsing without milliseconds
        if let dateWithoutMillis = withoutMillisFormatter.date(from: cleanedDateString) {
            return dateWithoutMillis
        }

        // If parsing still fails, return nil
        return nil
    }
}
