import SwiftUI
import Macaw
import VaultModels

/// Item logo view - displays logos or type-based icons for items
public struct ItemLogoView: View {

    /// Credit card brand type for local detection
    private enum CardBrand {
        case visa
        case mastercard
        case amex
        case discover
        case generic

        /// Detect credit card brand from card number using BIN prefixes
        static func detect(from cardNumber: String?) -> CardBrand {
            guard let cardNumber = cardNumber else { return .generic }

            let cleaned = cardNumber.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression)
            guard cleaned.range(of: "^\\d{4,}", options: .regularExpression) != nil else { return .generic }

            if cleaned.hasPrefix("4") { return .visa }
            if cleaned.range(of: "^5[1-5]", options: .regularExpression) != nil ||
               cleaned.range(of: "^2[2-7]", options: .regularExpression) != nil { return .mastercard }
            if cleaned.range(of: "^3[47]", options: .regularExpression) != nil { return .amex }
            if cleaned.range(of: "^6(?:011|22|4[4-9]|5)", options: .regularExpression) != nil { return .discover }

            return .generic
        }

        /// Get the SVG icon for this card brand from centralized definitions
        var icon: String {
            switch self {
            case .visa: return ItemTypeIcons.visa
            case .mastercard: return ItemTypeIcons.mastercard
            case .amex: return ItemTypeIcons.amex
            case .discover: return ItemTypeIcons.discover
            case .generic: return ItemTypeIcons.creditCard
            }
        }
    }

    let logoData: Data?
    let itemType: String?
    let cardNumber: String?

    public init(logoData: Data?, itemType: String? = nil, cardNumber: String? = nil) {
        self.logoData = logoData
        self.itemType = itemType
        self.cardNumber = cardNumber
    }

    private func detectMimeType(_ data: Data) -> String {
        // Check for SVG
        if let str = String(data: data.prefix(5), encoding: .utf8)?.lowercased(),
           str.contains("<?xml") || str.contains("<svg") {
            return "image/svg+xml"
        }

        // Check file signature for PNG
        let bytes = [UInt8](data.prefix(4))
        if bytes.count >= 4 &&
            bytes[0] == 0x89 && bytes[1] == 0x50 &&
            bytes[2] == 0x4E && bytes[3] == 0x47 {
            return "image/png"
        }

        return "image/x-icon"
    }

    private func renderSVGNode(_ data: Data) -> Node? {
        if let svgString = String(data: data, encoding: .utf8) {
            return try? SVGParser.parse(text: svgString)
        }
        return nil
    }

    struct SVGImageView: UIViewRepresentable {
        let node: Node

        func makeUIView(context: Context) -> MacawView {
            let macawView = MacawView(node: node, frame: CGRect(x: 0, y: 0, width: 32, height: 32))
            macawView.backgroundColor = .clear
            macawView.contentMode = .scaleAspectFit
            macawView.node.place = Transform.identity
            return macawView
        }

        func updateUIView(_ uiView: MacawView, context: Context) {
            uiView.node = node
            uiView.backgroundColor = .clear
            uiView.contentMode = .scaleAspectFit
            uiView.node.place = Transform.identity
        }
    }

    public var body: some View {
        Group {
            // If itemType is specified, use type-based rendering
            if let itemType = itemType {
                renderTypeBasedIcon(itemType: itemType)
            } else if let logoData = logoData {
                // Legacy logo rendering
                renderLogo(logoData: logoData)
            } else {
                // Fallback to placeholder
                renderPlaceholder()
            }
        }
    }

    /// Render icon based on item type
    private func renderTypeBasedIcon(itemType: String) -> some View {
        Group {
            // For Note type, always show note icon
            if itemType == ItemType.note {
                renderSVGIcon(svg: ItemTypeIcons.note)
            }
            // For CreditCard type, detect brand and show appropriate icon
            else if itemType == ItemType.creditCard {
                let brand = CardBrand.detect(from: cardNumber)
                renderSVGIcon(svg: brand.icon)
            }
            // For Login/Alias types, use Logo if available, otherwise placeholder
            else if let logoData = logoData, !logoData.isEmpty {
                renderLogo(logoData: logoData)
            } else {
                renderSVGIcon(svg: ItemTypeIcons.placeholder)
            }
        }
    }

    /// Render an SVG icon from string
    private func renderSVGIcon(svg: String) -> some View {
        Group {
            if let svgNode = try? SVGParser.parse(text: svg) {
                SVGImageView(node: svgNode)
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                // Fallback if SVG can't be parsed - simple colored rectangle
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.gray.opacity(0.3))
                    .frame(width: 32, height: 32)
            }
        }
    }

    /// Render logo from binary data
    private func renderLogo(logoData: Data) -> some View {
        Group {
            let mimeType = detectMimeType(logoData)
            if mimeType == "image/svg+xml",
               let svgNode = renderSVGNode(logoData) {
                SVGImageView(node: svgNode)
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else if let image = UIImage(data: logoData) {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                // Logo data couldn't be decoded, use centralized placeholder
                renderPlaceholder()
            }
        }
    }

    /// Render fallback placeholder using centralized SVG icon
    private func renderPlaceholder() -> some View {
        renderSVGIcon(svg: ItemTypeIcons.placeholder)
    }
}

#Preview {
    ItemLogoView(logoData: nil)
}
