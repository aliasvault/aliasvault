package net.aliasvault.app.utils

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * DateHelpers
 * -------------------------
 * Centralized utility for formatting Date values consistently across the client application.
 * All dates are stored in UTC with the format: "yyyy-MM-dd HH:mm:ss.SSS" (23 characters).
 * This format ensures:
 * - SQLite native support for date functions
 * - No timezone ambiguity (all dates are UTC)
 * - Consistent precision with milliseconds for accurate sorting/comparison
 * - Readable space separator instead of 'T'
 * - Lexicographic sorting works correctly
 * Other platform implementations: DateHelpers.ts (core/client), DateHelpers.swift (iOS).
 */
object DateHelpers {
    private const val TAG = "DateHelpers"

    /**
     * Standard date format for database storage: "yyyy-MM-dd HH:mm:ss.SSS" (23 characters).
     */
    private const val STANDARD_FORMAT = "yyyy-MM-dd HH:mm:ss.SSS"

    /**
     * Format a Date to the standard format string: "yyyy-MM-dd HH:mm:ss.SSS" (23 characters).
     *
     * @param date The Date to format
     * @return Formatted date-time string in format "yyyy-MM-dd HH:mm:ss.SSS"
     */
    fun toStandardFormat(date: Date): String {
        val formatter = SimpleDateFormat(STANDARD_FORMAT, Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(date)
    }

    /**
     * Format the current UTC time to the standard format string.
     *
     * @return Formatted current UTC date-time string
     */
    fun now(): String {
        return toStandardFormat(Date())
    }

    /**
     * Parse a date string to a Date object for use in queries.
     * Supports multiple formats for backward compatibility:
     * - "yyyy-MM-dd HH:mm:ss.SSS" (standard format with milliseconds)
     * - "yyyy-MM-dd HH:mm:ss" (standard format without milliseconds)
     * - "yyyy-MM-ddTHH:mm:ss.SSSZ" (ISO 8601 with milliseconds)
     * - "yyyy-MM-ddTHH:mm:ssZ" (ISO 8601 without milliseconds)
     *
     * @param dateString The date string to parse
     * @return Parsed Date or null if parsing fails
     */
    fun parseDateString(dateString: String?): Date? {
        if (dateString == null) {
            return null
        }

        // Normalize milliseconds to exactly 3 digits
        // Handles: 2025-10-20 13:48:10.4 -> 2025-10-20 13:48:10.400
        //          1992-10-21T23:49:44.336Z -> 1992-10-21T23:49:44.336Z (unchanged)
        //          2025-10-20 13:48:10 -> 2025-10-20 13:48:10 (unchanged)
        val normalizedDate = dateString.replace(
            Regex("""(\d{2}:\d{2}:\d{2})\.(\d{1,2})(?=[TZ\s]|$)"""),
        ) { matchResult ->
            val base = matchResult.groupValues[1]
            val millis = matchResult.groupValues[2].padEnd(3, '0')
            "$base.$millis"
        }

        // Try all supported formats
        val formats = listOf(
            // SQLite formats (local storage - most common, try first)
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            // ISO 8601 formats (from server/API)
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
        )

        for (format in formats) {
            @Suppress("SwallowedException")
            try {
                return format.parse(normalizedDate)
            } catch (e: Exception) {
                // Try next format
                continue
            }
        }

        Log.e(TAG, "Error parsing date: $dateString (normalized: $normalizedDate)")
        return null
    }
}
