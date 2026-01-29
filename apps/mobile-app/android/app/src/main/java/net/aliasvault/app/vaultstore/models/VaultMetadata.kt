package net.aliasvault.app.vaultstore.models

/**
 * Vault metadata object.
 */
data class VaultMetadata(
    /**
     * The public email domains of the vault.
     */
    val publicEmailDomains: List<String> = emptyList(),

    /**
     * The private email domains of the vault.
     */
    val privateEmailDomains: List<String> = emptyList(),

    /**
     * The hidden private email domains of the vault.
     * These domains still function as private email domains but are hidden from UI components.
     */
    val hiddenPrivateEmailDomains: List<String> = emptyList(),

    /**
     * The revision number of the vault.
     */
    val vaultRevisionNumber: Int = 0,
)
