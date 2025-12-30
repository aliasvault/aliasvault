package net.aliasvault.app.credentialprovider.models

import androidx.lifecycle.ViewModel
import net.aliasvault.app.vaultstore.PasskeyWithCredentialInfo
import java.util.UUID

/**
 * ViewModel to share passkey registration state between fragments.
 */
class PasskeyRegistrationViewModel : ViewModel() {
    /** The passkey request JSON string from the relying party. */
    var requestJson: String = ""

    /** The client data hash for passkey creation. */
    var clientDataHash: ByteArray? = null

    /** The origin URL of the passkey request. */
    var origin: String? = null

    /** Whether the caller is a privileged app (browser). */
    var isPrivilegedCaller: Boolean = false

    /** The relying party identifier. */
    var rpId: String = ""

    /** The relying party name (optional, from rp.name in the request). */
    var rpName: String? = null

    /** The username for the passkey. */
    var userName: String? = null

    /** The user display name for the passkey. */
    var userDisplayName: String? = null

    /** The user ID as a byte array. */
    var userId: ByteArray? = null

    /** List of existing passkeys for the relying party. */
    var existingPasskeys: List<PasskeyWithCredentialInfo> = emptyList()

    /** The passkey selected to be replaced, if any. */
    var selectedPasskeyToReplace: PasskeyWithCredentialInfo? = null

    /** Whether the user is in replace mode (true) or create new mode (false). */
    var isReplaceMode: Boolean = false

    /**
     * Called when the user selects to create a new passkey.
     */
    fun onCreateNewSelected() {
        isReplaceMode = false
        selectedPasskeyToReplace = null
    }

    /**
     * Called when the user selects to replace an existing passkey.
     */
    fun onReplaceSelected(passkeyInfo: PasskeyWithCredentialInfo) {
        isReplaceMode = true
        selectedPasskeyToReplace = passkeyInfo
    }

    /**
     * Get a passkey by its ID from the existing passkeys list.
     */
    fun getPasskeyById(id: UUID): PasskeyWithCredentialInfo? {
        return existingPasskeys.firstOrNull { it.passkey.id == id }
    }
}
