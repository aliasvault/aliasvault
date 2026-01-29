import Foundation

/// Navigation destinations for passkey registration flow
public enum PasskeyNavigationDestination: Hashable {
    case createNew
    case replace(UUID)
    case mergeWithItem(UUID)  // Add passkey to existing item without passkey
}
