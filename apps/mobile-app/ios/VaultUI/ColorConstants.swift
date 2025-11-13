import SwiftUI

/// Color constants for the app
public struct ColorConstants {
    /// Light mode colors
    public struct Light {
        public static let text = SwiftUI.Color(hex: "#11181C")
        public static let textMuted = SwiftUI.Color(hex: "#4b5563")
        public static let background = SwiftUI.Color(hex: "#f3f4f6")
        public static let accentBackground = SwiftUI.Color(hex: "#ffffff")
        public static let accentBorder = SwiftUI.Color(hex: "#d1d5db")
        public static let primary = SwiftUI.Color(hex: "#f49541")
        public static let secondary = SwiftUI.Color(hex: "#6b7280")
        public static let tertiary = SwiftUI.Color(hex: "#eabf69")
        public static let icon = SwiftUI.Color(hex: "#687076")
    }

    /// Dark mode colors
    public struct Dark {
        public static let text = SwiftUI.Color(hex: "#ECEDEE")
        public static let textMuted = SwiftUI.Color(hex: "#9BA1A6")
        public static let background = SwiftUI.Color(hex: "#000000")
        public static let accentBackground = SwiftUI.Color(hex: "#202020")
        public static let accentBorder = SwiftUI.Color(hex: "#444444")
        public static let primary = SwiftUI.Color(hex: "#f49541")
        public static let secondary = SwiftUI.Color(hex: "#6b7280")
        public static let tertiary = SwiftUI.Color(hex: "#eabf69")
        public static let icon = SwiftUI.Color(hex: "#9BA1A6")
    }

    /// Get colors for the specified color scheme
    /// - Parameter colorScheme: The current color scheme
    /// - Returns: The appropriate color constants (Light or Dark)
    public static func colors(for colorScheme: ColorScheme) -> Colors.Type {
        colorScheme == .dark ? Dark.self : Light.self
    }

    /// Protocol to enable generic access to color properties
    public protocol Colors {
        static var text: Color { get }
        static var textMuted: Color { get }
        static var background: Color { get }
        static var accentBackground: Color { get }
        static var accentBorder: Color { get }
        static var primary: Color { get }
        static var secondary: Color { get }
        static var tertiary: Color { get }
        static var icon: Color { get }
    }
}

// Conform Light and Dark to the Colors protocol
extension ColorConstants.Light: ColorConstants.Colors {}
extension ColorConstants.Dark: ColorConstants.Colors {}

// Add Color extension for hex support
extension SwiftUI.Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let colorA, colorR, colorG, colorB: UInt64
        switch hex.count {
        case 3: (colorA, colorR, colorG, colorB) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: (colorA, colorR, colorG, colorB) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (colorA, colorR, colorG, colorB) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (colorA, colorR, colorG, colorB) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(colorR) / 255,
            green: Double(colorG) / 255,
            blue: Double(colorB) / 255,
            opacity: Double(colorA) / 255
        )
    }
}
