import SwiftUI

/// Color constants for the app
public struct ColorConstants {
    /// Light mode colors
    public struct Light {
        static let text = SwiftUI.Color(hex: "#11181C")
        static let textMuted = SwiftUI.Color(hex: "#4b5563")
        static let background = SwiftUI.Color(hex: "#f3f4f6")
        static let accentBackground = SwiftUI.Color(hex: "#ffffff")
        static let accentBorder = SwiftUI.Color(hex: "#d1d5db")
        static let primary = SwiftUI.Color(hex: "#f49541")
        static let secondary = SwiftUI.Color(hex: "#6b7280")
        static let tertiary = SwiftUI.Color(hex: "#eabf69")
        static let icon = SwiftUI.Color(hex: "#687076")
    }

    /// Dark mode colors
    public struct Dark {
        static let text = SwiftUI.Color(hex: "#ECEDEE")
        static let textMuted = SwiftUI.Color(hex: "#9BA1A6")
        static let background = SwiftUI.Color(hex: "#000000")
        static let accentBackground = SwiftUI.Color(hex: "#202020")
        static let accentBorder = SwiftUI.Color(hex: "#444444")
        static let primary = SwiftUI.Color(hex: "#f49541")
        static let secondary = SwiftUI.Color(hex: "#6b7280")
        static let tertiary = SwiftUI.Color(hex: "#eabf69")
        static let icon = SwiftUI.Color(hex: "#9BA1A6")
    }
}

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
