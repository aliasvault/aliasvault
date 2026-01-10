package net.aliasvault.app.vaultstore.models

import java.util.Date
import java.util.UUID

/**
 * Item model representing vault entries in the new field-based data model.
 *
 * @property id The unique identifier of the item.
 * @property name The display name of the item.
 * @property itemType The type of item (Login, Alias, CreditCard, Note).
 * @property logo The logo image data in bytes.
 * @property folderId The ID of the folder containing this item.
 * @property folderPath The path to the folder containing this item.
 * @property fields The list of field values for this item.
 * @property hasPasskey Whether this item has an associated passkey.
 * @property hasAttachment Whether this item has attachments.
 * @property hasTotp Whether this item has TOTP codes.
 * @property createdAt The timestamp when this item was created.
 * @property updatedAt The timestamp when this item was last updated.
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
 *
 * @property fieldKey The key identifying this field.
 * @property label The display label for this field.
 * @property fieldType The type of field (text, password, email, etc).
 * @property value The field value.
 * @property isHidden Whether this field should be hidden by default.
 * @property displayOrder The order in which this field should be displayed.
 * @property isCustomField Whether this is a custom user-defined field.
 * @property enableHistory Whether to track history for this field.
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
