package net.aliasvault.app.vaultstore.mappers

import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.FieldType
import net.aliasvault.app.vaultstore.models.ItemField
import net.aliasvault.app.vaultstore.repositories.scopedKey

/**
 * Raw field row from a database query.
 *
 * @property itemId The item the value belongs to.
 * @property manifestId The manifest the item lives in.
 * @property fieldKey The system field key, null for a custom field.
 * @property fieldDefinitionId The custom field definition, null for a system field.
 * @property customLabel The custom field's label.
 * @property customFieldType The custom field's type.
 * @property customIsHidden Whether the custom field is masked.
 * @property customEnableHistory Whether the custom field keeps a value history.
 * @property value The field value.
 * @property displayOrder The position of the field on the item.
 */
data class FieldRow(
    val itemId: String,
    val manifestId: String,
    val fieldKey: String?,
    val fieldDefinitionId: String?,
    val customLabel: String?,
    val customFieldType: String?,
    val customIsHidden: Boolean,
    val customEnableHistory: Boolean,
    val value: String,
    val displayOrder: Int,
) {
    companion object {
        /**
         * Read a row from a query result, or null when the item key is missing.
         */
        fun fromRow(row: Map<String, Any?>): FieldRow? {
            val itemId = row["ItemId"] as? String ?: return null
            val manifestId = row["ManifestId"] as? String ?: return null
            return FieldRow(
                itemId = itemId,
                manifestId = manifestId,
                fieldKey = row["FieldKey"] as? String,
                fieldDefinitionId = row["FieldDefinitionId"] as? String,
                customLabel = row["CustomLabel"] as? String,
                customFieldType = row["CustomFieldType"] as? String,
                customIsHidden = (row["CustomIsHidden"] as? Long) == 1L,
                customEnableHistory = (row["CustomEnableHistory"] as? Long) == 1L,
                value = row["Value"] as? String ?: "",
                displayOrder = (row["DisplayOrder"] as? Long)?.toInt() ?: 0,
            )
        }
    }
}

/**
 * Maps field rows to ItemField objects: system fields (FieldKey) get their metadata from the registry below,
 * custom fields (FieldDefinitionId) from the row.
 * Other platform implementations: FieldMapper.ts (core/client), FieldMapper.swift (iOS).
 */
object FieldMapper {
    /**
     * Resolved metadata of one field.
     */
    private data class FieldMetadata(
        val label: String,
        val fieldType: String,
        val isHidden: Boolean,
        val enableHistory: Boolean,
    )

    /**
     * Group field rows by scoped item key (see `scopedKey`). Multi-value fields keep one ItemField per row.
     */
    fun processFieldRows(rows: List<FieldRow>): Map<String, List<ItemField>> {
        val fieldsByItem = mutableMapOf<String, MutableList<ItemField>>()
        for (row in rows) {
            fieldsByItem.getOrPut(scopedKey(row.manifestId, row.itemId)) { mutableListOf() }.add(processFieldRow(row))
        }
        return fieldsByItem
    }

    private fun processFieldRow(row: FieldRow): ItemField {
        val isCustomField = row.fieldDefinitionId != null && row.fieldKey == null
        val fieldKey = row.fieldKey ?: row.fieldDefinitionId ?: ""
        val metadata = if (isCustomField) {
            FieldMetadata(row.customLabel ?: fieldKey, row.customFieldType ?: FieldType.TEXT, row.customIsHidden, row.customEnableHistory)
        } else {
            resolveSystemFieldMetadata(fieldKey)
        }
        return ItemField(
            fieldKey = fieldKey,
            label = metadata.label,
            fieldType = metadata.fieldType,
            value = row.value,
            isHidden = metadata.isHidden,
            displayOrder = row.displayOrder,
            isCustomField = isCustomField,
            enableHistory = metadata.enableHistory,
        )
    }

    /**
     * Metadata of a system field; an unknown key is shown as plain text under its own name.
     */
    @Suppress("CyclomaticComplexMethod")
    private fun resolveSystemFieldMetadata(fieldKey: String): FieldMetadata {
        return when (fieldKey) {
            FieldKey.LOGIN_USERNAME -> FieldMetadata("Username", FieldType.TEXT, false, false)
            FieldKey.LOGIN_PASSWORD -> FieldMetadata("Password", FieldType.PASSWORD, true, true)
            FieldKey.LOGIN_EMAIL -> FieldMetadata("Email", FieldType.EMAIL, false, false)
            FieldKey.LOGIN_URL -> FieldMetadata("URL", FieldType.U_R_L, false, false)
            FieldKey.CARD_NUMBER -> FieldMetadata("Card Number", FieldType.TEXT, true, false)
            FieldKey.CARD_CARDHOLDER_NAME -> FieldMetadata("Cardholder Name", FieldType.TEXT, false, false)
            FieldKey.CARD_EXPIRY_MONTH -> FieldMetadata("Expiry Month", FieldType.TEXT, false, false)
            FieldKey.CARD_EXPIRY_YEAR -> FieldMetadata("Expiry Year", FieldType.TEXT, false, false)
            FieldKey.CARD_CVV -> FieldMetadata("CVV", FieldType.PASSWORD, true, false)
            FieldKey.CARD_PIN -> FieldMetadata("PIN", FieldType.PASSWORD, true, false)
            FieldKey.ALIAS_FIRST_NAME -> FieldMetadata("First Name", FieldType.TEXT, false, false)
            FieldKey.ALIAS_LAST_NAME -> FieldMetadata("Last Name", FieldType.TEXT, false, false)
            FieldKey.ALIAS_GENDER -> FieldMetadata("Gender", FieldType.TEXT, false, false)
            FieldKey.ALIAS_BIRTHDATE -> FieldMetadata("Birth Date", FieldType.DATE, false, false)
            FieldKey.NOTES_CONTENT -> FieldMetadata("Notes", FieldType.TEXT_AREA, false, false)
            else -> FieldMetadata(fieldKey, FieldType.TEXT, false, false)
        }
    }
}
