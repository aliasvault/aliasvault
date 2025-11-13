import SwiftUI

/// Reusable numpad view component for PIN entry
public struct PinNumpadView: View {
    let colorScheme: ColorScheme
    let onDigit: (String) -> Void
    let onBackspace: () -> Void

    public init(
        colorScheme: ColorScheme,
        onDigit: @escaping (String) -> Void,
        onBackspace: @escaping () -> Void
    ) {
        self.colorScheme = colorScheme
        self.onDigit = onDigit
        self.onBackspace = onBackspace
    }

    public var body: some View {
        VStack(spacing: 12) {
            // Row 1: 1-3
            HStack(spacing: 12) {
                ForEach(1...3, id: \.self) { num in
                    NumpadButton(value: "\(num)", colorScheme: colorScheme) {
                        onDigit("\(num)")
                    }
                }
            }

            // Row 2: 4-6
            HStack(spacing: 12) {
                ForEach(4...6, id: \.self) { num in
                    NumpadButton(value: "\(num)", colorScheme: colorScheme) {
                        onDigit("\(num)")
                    }
                }
            }

            // Row 3: 7-9
            HStack(spacing: 12) {
                ForEach(7...9, id: \.self) { num in
                    NumpadButton(value: "\(num)", colorScheme: colorScheme) {
                        onDigit("\(num)")
                    }
                }
            }

            // Row 4: Empty, 0, Backspace
            HStack(spacing: 12) {
                // Empty space
                Color.clear
                    .frame(height: 60)

                // 0 button
                NumpadButton(value: "0", colorScheme: colorScheme) {
                    onDigit("0")
                }

                // Backspace button
                NumpadButton(icon: "delete.left", colorScheme: colorScheme) {
                    onBackspace()
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 40)
    }
}
