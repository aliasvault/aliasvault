package net.aliasvault.app.vaultstore.models

import java.util.Date
import java.util.UUID

/**
 * Item model representing vault entries in the new field-based data model.
 */
data class Item(
    val id: UUID,
    val name: String?,
    val itemType: String,
    val logo: ByteArray?,
    val folderId: UUID?,
    val folderPath: String?,
    val fields: List<ItemField>,
    val hasPasskey: Boolean,
    val hasAttachment: Boolean,
    val hasTotp: Boolean,
    val createdAt: Date,
    val updatedAt: Date,
) {
    /**
     * Get the value of a field by its key.
     */
    fun getFieldValue(fieldKey: String): String? {
        return fields.find { it.fieldKey == fieldKey }?.value
    }

    /**
     * Get the URL field value (login.url).
     */
    val url: String?
        get() = getFieldValue(FieldKey.LOGIN_URL)

    /**
     * Get the username field value (login.username).
     */
    val username: String?
        get() = getFieldValue(FieldKey.LOGIN_USERNAME)

    /**
     * Get the password field value (login.password).
     */
    val password: String?
        get() = getFieldValue(FieldKey.LOGIN_PASSWORD)

    /**
     * Get the email field value (login.email).
     */
    val email: String?
        get() = getFieldValue(FieldKey.LOGIN_EMAIL)

    /**
     * Get the first name field value (alias.first_name).
     */
    val firstName: String?
        get() = getFieldValue(FieldKey.ALIAS_FIRST_NAME)

    /**
     * Get the last name field value (alias.last_name).
     */
    val lastName: String?
        get() = getFieldValue(FieldKey.ALIAS_LAST_NAME)

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as Item
        return id == other.id
    }

    override fun hashCode(): Int {
        return id.hashCode()
    }
}

/**
 * Field value within an item.
 */
data class ItemField(
    val fieldKey: String,
    val label: String,
    val fieldType: String,
    val value: String,
    val isHidden: Boolean,
    val displayOrder: Int,
    val isCustomField: Boolean,
    val enableHistory: Boolean,
)
