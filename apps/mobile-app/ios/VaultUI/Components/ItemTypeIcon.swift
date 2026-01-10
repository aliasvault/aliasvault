// swiftlint:disable line_length
import SwiftUI

/// Item type icon helper - provides SVG-based icons for different item types
public struct ItemTypeIcon {

    /// Item type enumeration matching the database model
    public enum ItemType: String {
        case login = "Login"
        case alias = "Alias"
        case creditCard = "CreditCard"
        case note = "Note"
    }

    /// Credit card brand type
    public enum CardBrand {
        case visa
        case mastercard
        case amex
        case discover
        case generic

        /// Detect credit card brand from card number using industry-standard prefixes
        public static func detect(from cardNumber: String?) -> CardBrand {
            guard let cardNumber = cardNumber else {
                return .generic
            }

            // Remove spaces and dashes
            let cleaned = cardNumber.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression)

            // Must be mostly numeric
            guard cleaned.range(of: "^\\d{4,}", options: .regularExpression) != nil else {
                return .generic
            }

            // Visa: starts with 4
            if cleaned.hasPrefix("4") {
                return .visa
            }

            // Mastercard: starts with 51-55 or 2221-2720
            if cleaned.range(of: "^5[1-5]", options: .regularExpression) != nil ||
                cleaned.range(of: "^2[2-7]", options: .regularExpression) != nil {
                return .mastercard
            }

            // Amex: starts with 34 or 37
            if cleaned.range(of: "^3[47]", options: .regularExpression) != nil {
                return .amex
            }

            // Discover: starts with 6011, 622, 644-649, 65
            if cleaned.range(of: "^6(?:011|22|4[4-9]|5)", options: .regularExpression) != nil {
                return .discover
            }

            return .generic
        }
    }

    /// Generic credit card icon SVG
    public static let creditCardIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541"/>
        <rect x="2" y="11" width="28" height="4" fill="#d68338"/>
        <rect x="5" y="18" width="8" height="2" rx="1" fill="#ffe096"/>
        <rect x="5" y="22" width="5" height="1.5" rx="0.75" fill="#fbcb74"/>
    </svg>
    """

    /// Visa card icon SVG
    public static let visaIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541"/>
        <path d="M13.5 13L11.5 19H10L8.5 14.5C8.5 14.5 8.35 14 8 14C7.65 14 7 13.8 7 13.8L7.05 13.5H9.5C9.85 13.5 10.15 13.75 10.2 14.1L10.8 17L12.5 13.5H13.5V13ZM15 19H14L15 13H16L15 19ZM20 13.5C20 13.5 19.4 13.3 18.7 13.3C17.35 13.3 16.4 14 16.4 15C16.4 15.8 17.1 16.2 17.65 16.5C18.2 16.8 18.4 17 18.4 17.2C18.4 17.5 18.05 17.7 17.6 17.7C17 17.7 16.5 17.5 16.5 17.5L16.3 18.7C16.3 18.7 16.9 19 17.7 19C19.2 19 20.1 18.2 20.1 17.1C20.1 15.7 18.4 15.6 18.4 15C18.4 14.7 18.7 14.5 19.15 14.5C19.6 14.5 20.1 14.7 20.1 14.7L20.3 13.5H20V13.5ZM24 19L23.1 13.5H22C21.7 13.5 21.45 13.7 21.35 13.95L19 19H20.5L20.8 18H22.7L22.9 19H24ZM21.2 17L22 14.5L22.45 17H21.2Z" fill="#ffe096"/>
    </svg>
    """

    /// Mastercard icon SVG
    public static let mastercardIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541"/>
        <circle cx="13" cy="16" r="5" fill="#d68338"/>
        <circle cx="19" cy="16" r="5" fill="#ffe096"/>
        <path d="M16 12.5C17.1 13.4 17.8 14.6 17.8 16C17.8 17.4 17.1 18.6 16 19.5C14.9 18.6 14.2 17.4 14.2 16C14.2 14.6 14.9 13.4 16 12.5Z" fill="#fbcb74"/>
    </svg>
    """

    /// Amex card icon SVG
    public static let amexIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541"/>
        <text x="16" y="18" text-anchor="middle" fill="#ffe096" font-size="8" font-weight="bold" font-family="Arial, sans-serif">AMEX</text>
    </svg>
    """

    /// Discover card icon SVG
    public static let discoverIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541"/>
        <circle cx="20" cy="16" r="4" fill="#ffe096"/>
        <path d="M7 14H8.5C9.3 14 10 14.7 10 15.5C10 16.3 9.3 17 8.5 17H7V14Z" fill="#ffe096"/>
        <rect x="11" y="14" width="1.5" height="3" fill="#ffe096"/>
        <path d="M14 15C14 14.4 14.4 14 15 14C15.3 14 15.5 14.1 15.7 14.3L16.5 13.5C16.1 13.2 15.6 13 15 13C13.9 13 13 13.9 13 15C13 16.1 13.9 17 15 17C15.6 17 16.1 16.8 16.5 16.5L15.7 15.7C15.5 15.9 15.3 16 15 16C14.4 16 14 15.6 14 15Z" fill="#ffe096"/>
    </svg>
    """

    /// Note/document icon SVG
    public static let noteIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4C6.9 4 6 4.9 6 6V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V11L19 4H8Z" fill="#f49541"/>
        <path d="M19 4V11H26L19 4Z" fill="#d68338"/>
        <rect x="10" y="14" width="12" height="1.5" rx="0.75" fill="#ffe096"/>
        <rect x="10" y="18" width="10" height="1.5" rx="0.75" fill="#ffe096"/>
        <rect x="10" y="22" width="8" height="1.5" rx="0.75" fill="#ffe096"/>
    </svg>
    """

    /// Placeholder key icon SVG for Login/Alias without logo
    public static let placeholderIcon = """
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="6.5" stroke="#f49541" stroke-width="2.5"/>
        <circle cx="10" cy="10" r="2.5" stroke="#f49541" stroke-width="2"/>
        <path d="M15 15L27 27" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M19 19L23 15" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M24 24L28 20" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
    """

    /// Get the appropriate SVG icon for a credit card brand
    public static func getCardIcon(for brand: CardBrand) -> String {
        switch brand {
        case .visa:
            return visaIcon
        case .mastercard:
            return mastercardIcon
        case .amex:
            return amexIcon
        case .discover:
            return discoverIcon
        case .generic:
            return creditCardIcon
        }
    }

    /// Get the appropriate SVG icon for an item type
    public static func getIcon(for itemType: ItemType, cardNumber: String? = nil) -> String {
        switch itemType {
        case .note:
            return noteIcon
        case .creditCard:
            let brand = CardBrand.detect(from: cardNumber)
            return getCardIcon(for: brand)
        case .login, .alias:
            return placeholderIcon
        }
    }
}
