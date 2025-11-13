import SwiftUI
import Macaw

/// Service logo view
public struct ServiceLogoView: View {

    private let placeholderImageBase64 = "UklGRjoEAABXRUJQVlA4IC4EAAAwFwCdASqAAIAAPpFCm0olo6Ihp5IraLASCWUA0eb/0s56RrLtCnYfLPiBshdXWMx8j1Ez65f169iA4xUDBTEV6ylMQeCIj2b7RngGi7gKZ9WjKdSoy9R8JcgOmjCMlDmLG20KhNo/i/Dc/Ah5GAvGfm8kfniV3AkR6fxN6eKwjDc6xrDgSfS48G5uGV6WzQt24YAVlLSK9BMwndzfHnePK1KFchFrL7O3ulB8cGNCeomu4o+l0SrS/JKblJ4WTzj0DAD++lCUEouSfgRKdiV2TiYCD+H+l3tANKSPQFPQuzi7rbvxqGeRmXB9kDwURaoSTTpYjA9REMUi9uA6aV7PWtBNXgUzMLowYMZeos6Xvyhb34GmufswMHA5ZyYpxzjTphOak4ZjNOiz8aScO5ygiTx99SqwX/uL+HSeVOSraHw8IymrMwm+jLxqN8BS8dGcItLlm/ioulqH2j4V8glDgSut+ExkxiD7m8TGPrrjCQNJbRDzpOFsyCyfBZupvp8QjGKW2KGziSZeIWes4aTB9tRmeEBhnUrmTDZQuXcc67Fg82KHrSfaeeOEq6jjuUjQ8wUnzM4Zz3dhrwSyslVz/WvnKqYkr4V/TTXPFF5EjF4rM1bHZ8bK63EfTnK41+n3n4gEFoYP4mXkNH0hntnYcdTqiE7Gn+q0BpRRxnkpBSZlA6Wa70jpW0FGqkw5e591A5/H+OV+60WAo+4Mi+NlsKrvLZ9EiVaPnoEFZlJQx1fA777AJ2MjXJ4KSsrWDWJi1lE8yPs8V6XvcC0chDTYt8456sKXAagCZyY+fzQriFMaddXyKQdG8qBqcdYjAsiIcjzaRFBBoOK9sU+sFY7N6B6+xtrlu3c37rQKkI3O2EoiJOris54EjJ5OFuumA0M6riNUuBf/MEPFBVx1JRcUEs+upEBsCnwYski7FT3TTqHrx7v5AjgFN97xhPTkmVpu6sxRnWBi1fxIRp8eWZeFM6mUcGgVk1WeVb1yhdV9hoMo2TsNEPE0tHo/wvuSJSzbZo7wibeXM9v/rRfKcx7X93rfiXVnyQ9f/5CaAQ4lxedPp/6uzLtOS4FyL0bCNeZ6L5w+AiuyWCTDFIYaUzhwfG+/YTQpWyeZCdQIKzhV+3GeXI2cxoP0ER/DlOKymf1gm+zRU3sqf1lBVQ0y+mK/Awl9bS3uaaQmI0FUyUwHUKP7PKuXnO+LcwDv4OfPT6hph8smc1EtMe5ib/apar/qZ9dyaEaElALJ1KKxnHziuvVl8atk1fINSQh7OtXDyqbPw9o/nGIpTnv5iFmwmWJLis2oyEgPkJqyx0vYI8rjkVEzKc8eQavAJBYSpjMwM193Swt+yJyjvaGYWPnqExxKiNarpB2WSO7soCAZXhS1uEYHryrK47BH6W1dRiruqT0xpLih3MXiwU3VDwAAAA==" // swiftlint:disable:this line_length

    let logoData: Data?
    @Environment(\.colorScheme) private var colorScheme

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    private var placeholderImage: UIImage? {
        if let data = Data(base64Encoded: placeholderImageBase64) {
            return UIImage(data: data)
        }
        return nil
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
            if let logoData = logoData {
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
                } else if let placeholder = placeholderImage {
                    Image(uiImage: placeholder)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            } else if let placeholder = placeholderImage {
                Image(uiImage: placeholder)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                // Ultimate fallback if placeholder fails to load
                Circle()
                    .fill(colors.accentBackground)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Circle()
                            .stroke(colors.accentBorder, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
    }
}

#Preview {
    ServiceLogoView(logoData: nil)
}
