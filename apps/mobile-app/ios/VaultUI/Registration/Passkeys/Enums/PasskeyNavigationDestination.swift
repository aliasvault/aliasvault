import Foundation

/// Navigation destinations for passkey registration flow
public enum PasskeyNavigationDestination: Hashable {
    case createNew
    case replace(UUID)
}
