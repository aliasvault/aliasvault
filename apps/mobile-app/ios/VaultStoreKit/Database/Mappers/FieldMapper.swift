import Foundation
import VaultModels

/// Raw field row from database query.
public struct FieldRow {
    public let itemId: String
    public let fieldKey: String?
    public let fieldDefinitionId: String?
    public let customLabel: String?
    public let customFieldType: String?
    public let customIsHidden: Int64?
    public let customEnableHistory: Int64?
    public let value: String
    public let displayOrder: Int

    public init(
        itemId: String,
        fieldKey: String?,
        fieldDefinitionId: String?,
        customLabel: String?,
        customFieldType: String?,
        customIsHidden: Int64?,
        customEnableHistory: Int64?,
        value: String,
        displayOrder: Int
    ) {
        self.itemId = itemId
        self.fieldKey = fieldKey
        self.fieldDefinitionId = fieldDefinitionId
        self.customLabel = customLabel
        self.customFieldType = customFieldType
        self.customIsHidden = customIsHidden
        self.customEnableHistory = customEnableHistory
        self.value = value
        self.displayOrder = displayOrder
    }

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let itemId = row["ItemId"] as? String else { return nil }

        self.itemId = itemId
        self.fieldKey = row["FieldKey"] as? String
        self.fieldDefinitionId = row["FieldDefinitionId"] as? String
        self.customLabel = row["CustomLabel"] as? String
        self.customFieldType = row["CustomFieldType"] as? String
        self.customIsHidden = row["CustomIsHidden"] as? Int64
        self.customEnableHistory = row["CustomEnableHistory"] as? Int64
        self.value = row["Value"] as? String ?? ""
        self.displayOrder = Int(row["DisplayOrder"] as? Int64 ?? 0)
    }
}

/// Raw field row for single item queries (without ItemId).
public struct SingleItemFieldRow {
    public let fieldKey: String?
    public let fieldDefinitionId: String?
    public let customLabel: String?
    public let customFieldType: String?
    public let customIsHidden: Int64?
    public let customEnableHistory: Int64?
    public let value: String
    public let displayOrder: Int

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        self.fieldKey = row["FieldKey"] as? String
        self.fieldDefinitionId = row["FieldDefinitionId"] as? String
        self.customLabel = row["CustomLabel"] as? String
        self.customFieldType = row["CustomFieldType"] as? String
        self.customIsHidden = row["CustomIsHidden"] as? Int64
        self.customEnableHistory = row["CustomEnableHistory"] as? Int64
        self.value = row["Value"] as? String ?? ""
        self.displayOrder = Int(row["DisplayOrder"] as? Int64 ?? 0)
    }
}

/// Intermediate field representation before grouping.
public struct ProcessedField {
    public let itemId: String
    public let fieldKey: String
    public let label: String
    public let fieldType: String
    public let isHidden: Bool
    public let value: String
    public let displayOrder: Int
    public let isCustomField: Bool
    public let enableHistory: Bool
}

/// Mapper class for processing database field rows into ItemField objects.
/// Handles both system fields (with FieldKey) and custom fields (with FieldDefinitionId).
public struct FieldMapper {
    /// Process raw field rows from database into a map of ItemId -> [ItemField].
    /// Handles system vs custom fields and multi-value field grouping.
    /// - Parameter rows: Raw field rows from database
    /// - Returns: Dictionary of ItemId to array of ItemField objects
    public static func processFieldRows(_ rows: [FieldRow]) -> [String: [ItemField]] {
        // First, convert rows to processed fields with proper metadata
        let processedFields = rows.map { processFieldRow($0) }

        // Group by ItemId and FieldKey (to handle multi-value fields)
        var fieldsByItem: [String: [ItemField]] = [:]
        var fieldValuesByKey: [String: [String]] = [:]

        for field in processedFields {
            let key = "\(field.itemId)_\(field.fieldKey)"

            // Accumulate values for the same field
            if fieldValuesByKey[key] == nil {
                fieldValuesByKey[key] = []
            }
            fieldValuesByKey[key]!.append(field.value)

            // Create ItemField entry only once per unique FieldKey per item
            if fieldsByItem[field.itemId] == nil {
                fieldsByItem[field.itemId] = []
            }

            let itemFields = fieldsByItem[field.itemId]!
            let existingField = itemFields.first { $0.fieldKey == field.fieldKey }

            if existingField == nil {
                let itemField = ItemField(
                    fieldKey: field.fieldKey,
                    label: field.label,
                    fieldType: field.fieldType,
                    value: "", // Will be set below
                    isHidden: field.isHidden,
                    displayOrder: field.displayOrder,
                    isCustomField: field.isCustomField,
                    enableHistory: field.enableHistory
                )
                fieldsByItem[field.itemId]!.append(itemField)
            }
        }

        // Set Values (using first value for single value or concatenated for multi-value)
        for (itemId, fields) in fieldsByItem {
            var updatedFields: [ItemField] = []
            for field in fields {
                let key = "\(itemId)_\(field.fieldKey)"
                let values = fieldValuesByKey[key] ?? []

                // Use first value (multi-value fields would need different handling in the model)
                let value = values.first ?? ""

                let updatedField = ItemField(
                    fieldKey: field.fieldKey,
                    label: field.label,
                    fieldType: field.fieldType,
                    value: value,
                    isHidden: field.isHidden,
                    displayOrder: field.displayOrder,
                    isCustomField: field.isCustomField,
                    enableHistory: field.enableHistory
                )
                updatedFields.append(updatedField)
            }
            fieldsByItem[itemId] = updatedFields
        }

        return fieldsByItem
    }

    /// Process a single field row to extract proper metadata.
    /// System fields use FieldKey and get metadata from SystemFieldRegistry.
    /// Custom fields use FieldDefinitionId and get metadata from the row.
    /// - Parameter row: Raw field row
    /// - Returns: Processed field with proper metadata
    private static func processFieldRow(_ row: FieldRow) -> ProcessedField {
        if let fieldKey = row.fieldKey, !fieldKey.isEmpty {
            // System field: has FieldKey, get metadata from field metadata resolver
            let metadata = resolveFieldMetadata(
                fieldKey: fieldKey,
                customLabel: nil,
                customFieldType: nil,
                customIsHidden: false,
                customEnableHistory: false,
                isCustomField: false
            )
            return ProcessedField(
                itemId: row.itemId,
                fieldKey: fieldKey,
                label: metadata.label,
                fieldType: metadata.fieldType,
                isHidden: metadata.isHidden,
                value: row.value,
                displayOrder: row.displayOrder,
                isCustomField: false,
                enableHistory: metadata.enableHistory
            )
        } else {
            // Custom field: has FieldDefinitionId, get metadata from FieldDefinitions
            let fieldKey = row.fieldDefinitionId ?? ""
            return ProcessedField(
                itemId: row.itemId,
                fieldKey: fieldKey,
                label: row.customLabel ?? "",
                fieldType: row.customFieldType ?? FieldType.text,
                isHidden: row.customIsHidden == 1,
                value: row.value,
                displayOrder: row.displayOrder,
                isCustomField: true,
                enableHistory: row.customEnableHistory == 1
            )
        }
    }

    /// Process field rows for a single item (without ItemId in result).
    /// Used when fetching a single item by ID.
    /// - Parameter rows: Raw field rows for a single item
    /// - Returns: Array of ItemField objects
    public static func processFieldRowsForSingleItem(_ rows: [SingleItemFieldRow]) -> [ItemField] {
        var fieldValuesByKey: [String: [String]] = [:]
        var uniqueFields: [String: UniqueFieldData] = [:]

        for row in rows {
            let fieldKey = row.fieldKey ?? row.fieldDefinitionId ?? ""

            // Accumulate values
            if fieldValuesByKey[fieldKey] == nil {
                fieldValuesByKey[fieldKey] = []
            }
            fieldValuesByKey[fieldKey]!.append(row.value)

            // Store field metadata (only once per FieldKey)
            if uniqueFields[fieldKey] == nil {
                if let rowFieldKey = row.fieldKey, !rowFieldKey.isEmpty {
                    // System field
                    let metadata = resolveFieldMetadata(
                        fieldKey: rowFieldKey,
                        customLabel: nil,
                        customFieldType: nil,
                        customIsHidden: false,
                        customEnableHistory: false,
                        isCustomField: false
                    )
                    uniqueFields[fieldKey] = UniqueFieldData(
                        fieldKey: rowFieldKey,
                        label: metadata.label,
                        fieldType: metadata.fieldType,
                        isHidden: metadata.isHidden,
                        displayOrder: row.displayOrder,
                        isCustomField: false,
                        enableHistory: metadata.enableHistory
                    )
                } else {
                    // Custom field
                    uniqueFields[fieldKey] = UniqueFieldData(
                        fieldKey: fieldKey,
                        label: row.customLabel ?? "",
                        fieldType: row.customFieldType ?? FieldType.text,
                        isHidden: row.customIsHidden == 1,
                        displayOrder: row.displayOrder,
                        isCustomField: true,
                        enableHistory: row.customEnableHistory == 1
                    )
                }
            }
        }

        // Build fields array with proper single/multi values
        return uniqueFields.map { (fieldKey, fieldData) in
            let values = fieldValuesByKey[fieldKey] ?? []
            let value = values.first ?? ""

            return ItemField(
                fieldKey: fieldData.fieldKey,
                label: fieldData.label,
                fieldType: fieldData.fieldType,
                value: value,
                isHidden: fieldData.isHidden,
                displayOrder: fieldData.displayOrder,
                isCustomField: fieldData.isCustomField,
                enableHistory: fieldData.enableHistory
            )
        }.sorted { $0.displayOrder < $1.displayOrder }
    }

    // MARK: - Field Metadata Resolution

    /// Helper struct to hold resolved field metadata.
    private struct FieldMetadata {
        let label: String
        let fieldType: String
        let isHidden: Bool
        let enableHistory: Bool
    }

    /// Helper struct to hold unique field data for single item processing.
    private struct UniqueFieldData {
        let fieldKey: String
        let label: String
        let fieldType: String
        let isHidden: Bool
        let displayOrder: Int
        let isCustomField: Bool
        let enableHistory: Bool
    }

    /// Resolve field metadata for system fields and custom fields.
    private static func resolveFieldMetadata(
        fieldKey: String,
        customLabel: String?,
        customFieldType: String?,
        customIsHidden: Bool,
        customEnableHistory: Bool,
        isCustomField: Bool
    ) -> FieldMetadata {
        if isCustomField {
            return FieldMetadata(
                label: customLabel ?? fieldKey,
                fieldType: customFieldType ?? FieldType.text,
                isHidden: customIsHidden,
                enableHistory: customEnableHistory
            )
        }

        // System field metadata based on FieldKey constants
        switch fieldKey {
        case FieldKey.loginUsername:
            return FieldMetadata(label: "Username", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.loginPassword:
            return FieldMetadata(label: "Password", fieldType: FieldType.password, isHidden: true, enableHistory: true)
        case FieldKey.loginEmail:
            return FieldMetadata(label: "Email", fieldType: FieldType.email, isHidden: false, enableHistory: false)
        case FieldKey.loginUrl:
            return FieldMetadata(label: "URL", fieldType: FieldType.uRL, isHidden: false, enableHistory: false)
        case FieldKey.cardNumber:
            return FieldMetadata(label: "Card Number", fieldType: FieldType.text, isHidden: true, enableHistory: false)
        case FieldKey.cardCardholderName:
            return FieldMetadata(label: "Cardholder Name", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.cardExpiryMonth:
            return FieldMetadata(label: "Expiry Month", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.cardExpiryYear:
            return FieldMetadata(label: "Expiry Year", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.cardCvv:
            return FieldMetadata(label: "CVV", fieldType: FieldType.password, isHidden: true, enableHistory: false)
        case FieldKey.cardPin:
            return FieldMetadata(label: "PIN", fieldType: FieldType.password, isHidden: true, enableHistory: false)
        case FieldKey.aliasFirstName:
            return FieldMetadata(label: "First Name", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.aliasLastName:
            return FieldMetadata(label: "Last Name", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.aliasGender:
            return FieldMetadata(label: "Gender", fieldType: FieldType.text, isHidden: false, enableHistory: false)
        case FieldKey.aliasBirthdate:
            return FieldMetadata(label: "Birth Date", fieldType: FieldType.date, isHidden: false, enableHistory: false)
        case FieldKey.notesContent:
            return FieldMetadata(label: "Notes", fieldType: FieldType.textArea, isHidden: false, enableHistory: false)
        default:
            // Unknown system field - use field key as label
            return FieldMetadata(label: fieldKey, fieldType: FieldType.text, isHidden: false, enableHistory: false)
        }
    }
}
