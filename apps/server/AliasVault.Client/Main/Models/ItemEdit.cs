//-----------------------------------------------------------------------
// <copyright file="ItemEdit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.Client.Resources;
using AliasVault.Client.Services;

/// <summary>
/// Item edit model for add/edit forms.
/// Uses a dynamic fields-based approach for flexibility when adding new system fields.
/// </summary>
public sealed class ItemEdit
{
    /// <summary>
    /// Gets or sets the Id of the item.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the item type (Login, Alias, CreditCard, Note).
    /// </summary>
    public string ItemType { get; set; } = "Login";

    /// <summary>
    /// Gets or sets the name of the service/item.
    /// </summary>
    [Required(ErrorMessageResourceType = typeof(ValidationMessages), ErrorMessageResourceName = nameof(ValidationMessages.ServiceNameRequired))]
    [Display(Name = "Service Name")]
    public string ServiceName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the logo ID.
    /// </summary>
    public Guid? LogoId { get; set; }

    /// <summary>
    /// Gets or sets the logo bytes.
    /// </summary>
    public byte[]? ServiceLogo { get; set; }

    /// <summary>
    /// Gets or sets the folder ID.
    /// </summary>
    public Guid? FolderId { get; set; }

    /// <summary>
    /// Gets or sets the create date.
    /// </summary>
    public DateTime CreateDate { get; set; }

    /// <summary>
    /// Gets or sets the last update date.
    /// </summary>
    public DateTime LastUpdate { get; set; }

    /// <summary>
    /// Gets or sets the dynamic fields list (both system and custom fields).
    /// </summary>
    public List<SystemFieldEdit> Fields { get; set; } = [];

    /// <summary>
    /// Gets or sets the Attachment list.
    /// </summary>
    public List<Attachment> Attachments { get; set; } = [];

    /// <summary>
    /// Gets or sets the TOTP codes list.
    /// </summary>
    public List<TotpCode> TotpCodes { get; set; } = [];

    /// <summary>
    /// Gets or sets the Passkeys list.
    /// </summary>
    public List<Passkey> Passkeys { get; set; } = [];

    /// <summary>
    /// Creates an ItemEdit instance from an Item entity.
    /// Creates clones of Attachments, TotpCodes, and Passkeys to avoid modifying EF-tracked entities.
    /// Handles null navigation properties defensively to prevent errors from incomplete data loads.
    /// </summary>
    /// <param name="item">The item entity to convert.</param>
    /// <returns>A new ItemEdit instance.</returns>
    public static ItemEdit FromEntity(Item item)
    {
        var edit = new ItemEdit
        {
            Id = item.Id,
            ItemType = item.ItemType,
            ServiceName = item.Name ?? string.Empty,
            LogoId = item.LogoId,
            ServiceLogo = item.Logo?.FileData,
            FolderId = item.FolderId,
            Attachments = item.Attachments?.Where(a => !a.IsDeleted).Select(CloneAttachment).ToList() ?? [],
            TotpCodes = item.TotpCodes?.Where(t => !t.IsDeleted).Select(CloneTotpCode).ToList() ?? [],
            Passkeys = item.Passkeys?.Where(p => !p.IsDeleted).Select(ClonePasskey).ToList() ?? [],
            CreateDate = item.CreatedAt,
            LastUpdate = item.UpdatedAt,
        };

        // Group field values by FieldKey to handle multi-value fields
        var groupedFields = (item.FieldValues ?? [])
            .Where(f => !f.IsDeleted)
            .GroupBy(f => f.FieldKey ?? f.FieldDefinitionId?.ToString() ?? string.Empty);

        foreach (var group in groupedFields)
        {
            var firstFv = group.First();
            var isCustomField = firstFv.FieldDefinitionId != null && string.IsNullOrEmpty(firstFv.FieldKey);
            var systemField = !string.IsNullOrEmpty(firstFv.FieldKey) ? SystemFieldRegistry.GetSystemField(firstFv.FieldKey) : null;
            var isMultiValue = systemField?.IsMultiValue ?? false;

            var fieldEdit = new SystemFieldEdit
            {
                FieldKey = firstFv.FieldKey ?? firstFv.FieldDefinitionId?.ToString() ?? string.Empty,
                FieldValueId = firstFv.Id,
                FieldDefinitionId = firstFv.FieldDefinitionId,
                Label = isCustomField
                    ? firstFv.FieldDefinition?.Label ?? "Custom Field"
                    : firstFv.FieldKey ?? string.Empty,
                FieldType = isCustomField
                    ? firstFv.FieldDefinition?.FieldType ?? "Text"
                    : systemField?.FieldType ?? "Text",
                IsCustomField = isCustomField,
                IsHidden = isCustomField
                    ? firstFv.FieldDefinition?.IsHidden ?? false
                    : systemField?.IsHidden ?? false,
                EnableHistory = isCustomField
                    ? firstFv.FieldDefinition?.EnableHistory ?? false
                    : systemField?.EnableHistory ?? false,
                DisplayOrder = systemField?.DefaultDisplayOrder ?? firstFv.Weight,
                Category = GetCategoryFromFieldKey(firstFv.FieldKey),
                IsMultiValue = isMultiValue,
                Values = group.OrderBy(fv => fv.Weight).Select(fv => fv.Value ?? string.Empty).ToList(),
            };

            // Set Value to first value for easier handling with single-value form components
            fieldEdit.Value = fieldEdit.Values.FirstOrDefault() ?? string.Empty;

            edit.Fields.Add(fieldEdit);
        }

        return edit;
    }

    /// <summary>
    /// Converts this ItemEdit instance to an Item entity.
    /// </summary>
    /// <returns>A new Item entity.</returns>
    public Item ToEntity()
    {
        var item = new Item
        {
            Id = Id,
            Name = ServiceName,
            ItemType = ItemType,
            LogoId = LogoId,
            FolderId = FolderId,
            Attachments = Attachments,
            TotpCodes = TotpCodes,
        };

        // Convert all fields to FieldValue entities
        foreach (var field in Fields)
        {
            // Check if field has any values (single or multi)
            var hasValue = !string.IsNullOrEmpty(field.Value) ||
                          (field.IsMultiValue && field.Values.Any(v => !string.IsNullOrEmpty(v)));

            // For system fields, skip if no value
            // For custom fields, always persist (even if empty) - they're only deleted when explicitly removed
            if (!hasValue && !field.IsCustomField)
            {
                continue;
            }

            if (field.IsCustomField)
            {
                // Custom field handling
                var now = DateTime.UtcNow;

                if (field.FieldDefinitionId == null || field.FieldDefinitionId == Guid.Empty)
                {
                    // New custom field - create FieldDefinition
                    var fieldDefinitionId = !string.IsNullOrEmpty(field.TempId) && Guid.TryParse(field.TempId, out var parsedGuid)
                        ? parsedGuid
                        : Guid.NewGuid();

                    var fieldDefinition = new FieldDefinition
                    {
                        Id = fieldDefinitionId,
                        FieldType = field.FieldType,
                        Label = field.Label,
                        IsHidden = field.IsHidden,
                        IsMultiValue = false,
                        EnableHistory = false,
                        Weight = field.DisplayOrder,
                        CreatedAt = now,
                        UpdatedAt = now,
                    };

                    item.FieldValues.Add(new FieldValue
                    {
                        Id = Guid.NewGuid(),
                        ItemId = item.Id,
                        FieldDefinitionId = fieldDefinitionId,
                        FieldDefinition = fieldDefinition,
                        FieldKey = null,
                        Value = field.Value,
                        Weight = field.DisplayOrder,
                    });
                }
                else
                {
                    // Existing custom field - update value and include FieldDefinition
                    var fieldValue = new FieldValue
                    {
                        Id = field.FieldValueId != Guid.Empty ? field.FieldValueId : Guid.NewGuid(),
                        ItemId = item.Id,
                        FieldDefinitionId = field.FieldDefinitionId,
                        FieldKey = null,
                        Value = field.Value,
                        Weight = field.DisplayOrder,
                    };

                    // Include FieldDefinition with potentially updated label
                    fieldValue.FieldDefinition = new FieldDefinition
                    {
                        Id = field.FieldDefinitionId.Value,
                        Label = field.Label,
                        FieldType = field.FieldType,
                        IsHidden = field.IsHidden,
                        IsMultiValue = false,
                        EnableHistory = false,
                        Weight = field.DisplayOrder,
                    };

                    item.FieldValues.Add(fieldValue);
                }
            }
            else if (field.IsMultiValue)
            {
                // Multi-value system field (e.g., login.url) - create separate FieldValue for each value
                var nonEmptyValues = field.Values.Where(v => !string.IsNullOrEmpty(v)).ToList();
                for (int i = 0; i < nonEmptyValues.Count; i++)
                {
                    item.FieldValues.Add(new FieldValue
                    {
                        Id = Guid.NewGuid(),
                        ItemId = item.Id,
                        FieldKey = field.FieldKey,
                        Value = nonEmptyValues[i],
                        Weight = i, // Use index as weight for ordering
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow,
                    });
                }
            }
            else
            {
                // Single-value system field
                ItemService.SetFieldValue(item, field.FieldKey, field.Value);
            }
        }

        return item;
    }

    /// <summary>
    /// Gets the value of a field by its field key.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>The field value or empty string.</returns>
    public string GetFieldValue(string fieldKey)
    {
        return Fields.FirstOrDefault(f => f.FieldKey == fieldKey)?.Value ?? string.Empty;
    }

    /// <summary>
    /// Gets all values for a multi-value field by its field key.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>List of field values.</returns>
    public List<string> GetFieldValues(string fieldKey)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey);
        if (field == null)
        {
            return new List<string>();
        }

        return field.IsMultiValue && field.Values.Any()
            ? field.Values.Where(v => !string.IsNullOrEmpty(v)).ToList()
            : (string.IsNullOrEmpty(field.Value) ? new List<string>() : new List<string> { field.Value });
    }

    /// <summary>
    /// Sets multiple values for a multi-value field.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="values">The values to set.</param>
    public void SetFieldValues(string fieldKey, List<string> values)
    {
        var field = GetField(fieldKey);
        if (field != null)
        {
            field.Values = values ?? new List<string>();
            field.Value = values?.FirstOrDefault() ?? string.Empty;
        }
    }

    /// <summary>
    /// Gets a field by its field key.
    /// If the field doesn't exist, creates it based on the system field definition.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>The field or null if not a valid system field.</returns>
    public SystemFieldEdit? GetField(string fieldKey)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey);
        if (field != null)
        {
            return field;
        }

        // Field doesn't exist - create it if it's a valid system field
        var systemField = SystemFieldRegistry.GetSystemField(fieldKey);
        if (systemField == null)
        {
            return null;
        }

        field = new SystemFieldEdit
        {
            FieldKey = fieldKey,
            Label = fieldKey,
            FieldType = systemField.FieldType,
            Value = string.Empty,
            Values = systemField.IsMultiValue ? new List<string> { string.Empty } : new List<string>(),
            IsCustomField = false,
            IsHidden = systemField.IsHidden,
            EnableHistory = systemField.EnableHistory,
            DisplayOrder = systemField.DefaultDisplayOrder,
            Category = systemField.Category,
            IsMultiValue = systemField.IsMultiValue,
        };
        Fields.Add(field);
        return field;
    }

    /// <summary>
    /// Sets the value of a field by its field key.
    /// If the field doesn't exist, it will be added.
    /// For multi-value fields, this sets the first value.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="value">The value to set.</param>
    public void SetFieldValue(string fieldKey, string value)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey);
        if (field != null)
        {
            field.Value = value;

            // Also update Values list for multi-value fields
            if (field.IsMultiValue)
            {
                field.Values = string.IsNullOrEmpty(value)
                    ? new List<string> { string.Empty }
                    : new List<string> { value };
            }
        }
        else
        {
            // Add new field based on system field definition
            var systemField = SystemFieldRegistry.GetSystemField(fieldKey);
            if (systemField != null)
            {
                var isMultiValue = systemField.IsMultiValue;
                Fields.Add(new SystemFieldEdit
                {
                    FieldKey = fieldKey,
                    Label = fieldKey,
                    FieldType = systemField.FieldType,
                    Value = value,
                    Values = isMultiValue
                        ? (string.IsNullOrEmpty(value) ? new List<string> { string.Empty } : new List<string> { value })
                        : new List<string>(),
                    IsCustomField = false,
                    IsHidden = systemField.IsHidden,
                    EnableHistory = systemField.EnableHistory,
                    DisplayOrder = systemField.DefaultDisplayOrder,
                    Category = systemField.Category,
                    IsMultiValue = isMultiValue,
                });
            }
        }
    }

    /// <summary>
    /// Checks if a field has a non-empty value.
    /// For multi-value fields, checks if any value is non-empty.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>True if the field has a value.</returns>
    public bool HasFieldValue(string fieldKey)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey);
        if (field == null)
        {
            return false;
        }

        if (field.IsMultiValue)
        {
            return field.Values.Any(v => !string.IsNullOrEmpty(v));
        }

        return !string.IsNullOrEmpty(field.Value);
    }

    /// <summary>
    /// Gets all custom fields sorted by display order.
    /// </summary>
    /// <returns>List of custom fields sorted by display order.</returns>
    public List<SystemFieldEdit> GetCustomFields()
    {
        return Fields.Where(f => f.IsCustomField).OrderBy(f => f.DisplayOrder).ToList();
    }

    /// <summary>
    /// Gets all system fields.
    /// </summary>
    /// <returns>List of system fields.</returns>
    public List<SystemFieldEdit> GetSystemFields()
    {
        return Fields.Where(f => !f.IsCustomField).ToList();
    }

    /// <summary>
    /// Adds a new custom field.
    /// </summary>
    /// <param name="label">The field label.</param>
    /// <param name="fieldType">The field type.</param>
    public void AddCustomField(string label, string fieldType)
    {
        var tempId = Guid.NewGuid().ToString();
        Fields.Add(new SystemFieldEdit
        {
            FieldKey = tempId,
            TempId = tempId,
            Label = label,
            FieldType = fieldType,
            Value = string.Empty,
            IsCustomField = true,
            IsHidden = fieldType == FieldType.Hidden || fieldType == FieldType.Password,
            EnableHistory = false,
            DisplayOrder = Fields.Count,
            Category = FieldCategory.Custom,
            IsMultiValue = false,
        });
    }

    /// <summary>
    /// Removes a custom field by its field key (TempId or FieldDefinitionId).
    /// </summary>
    /// <param name="fieldKey">The field key to remove.</param>
    public void RemoveCustomField(string fieldKey)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey && f.IsCustomField);
        if (field != null)
        {
            Fields.Remove(field);
        }
    }

    /// <summary>
    /// Updates the label of a custom field.
    /// </summary>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="newLabel">The new label.</param>
    public void UpdateCustomFieldLabel(string fieldKey, string newLabel)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey && f.IsCustomField);
        if (field != null)
        {
            field.Label = newLabel;
        }
    }

    /// <summary>
    /// Removes a field by its field key and clears its value.
    /// </summary>
    /// <param name="fieldKey">The field key to remove.</param>
    public void RemoveField(string fieldKey)
    {
        var field = Fields.FirstOrDefault(f => f.FieldKey == fieldKey);
        if (field != null)
        {
            if (field.IsCustomField)
            {
                Fields.Remove(field);
            }
            else
            {
                // For system fields, just clear the value (they can be re-added)
                field.Value = string.Empty;
            }
        }
    }

    /// <summary>
    /// Gets fields by category.
    /// </summary>
    /// <param name="category">The category to filter by.</param>
    /// <returns>List of fields in the specified category.</returns>
    public List<SystemFieldEdit> GetFieldsByCategory(FieldCategory category)
    {
        return Fields
            .Where(f => f.Category == category && !string.IsNullOrEmpty(f.Value))
            .OrderBy(f => f.DisplayOrder)
            .ToList();
    }

    /// <summary>
    /// Clears all field values for a specific item type that don't apply to the new type.
    /// </summary>
    /// <param name="newItemType">The new item type.</param>
    public void ClearFieldsNotApplicableToType(string newItemType)
    {
        foreach (var field in Fields.Where(f => !f.IsCustomField).ToList())
        {
            var systemField = SystemFieldRegistry.GetSystemField(field.FieldKey);
            if (systemField != null && !SystemFieldRegistry.FieldAppliesToType(systemField, newItemType))
            {
                field.Value = string.Empty;
            }
        }
    }

    /// <summary>
    /// Gets the field category from a field key.
    /// Uses the SystemFieldRegistry to look up the category for known system fields.
    /// Falls back to Custom category for unknown fields.
    /// </summary>
    private static FieldCategory GetCategoryFromFieldKey(string? fieldKey)
    {
        if (string.IsNullOrEmpty(fieldKey))
        {
            return FieldCategory.Custom;
        }

        // Look up category from SystemFieldRegistry for known system fields
        var systemField = SystemFieldRegistry.GetSystemField(fieldKey);
        if (systemField != null)
        {
            return systemField.Category;
        }

        // For unknown fields with a system field prefix, this might be a new system field
        // not yet in the registry - treat as custom for now
        return FieldCategory.Custom;
    }

    /// <summary>
    /// Creates a clone of an Attachment entity to avoid modifying EF-tracked entities.
    /// Handles null blob data defensively to prevent errors from corrupted sync data.
    /// </summary>
    /// <param name="attachment">The attachment to clone.</param>
    /// <returns>A new Attachment instance with copied values.</returns>
    private static Attachment CloneAttachment(Attachment attachment)
    {
        return new Attachment
        {
            Id = attachment.Id,
            Filename = attachment.Filename ?? string.Empty,
            Blob = attachment.Blob ?? [],
            ItemId = attachment.ItemId,
            CreatedAt = attachment.CreatedAt,
            UpdatedAt = attachment.UpdatedAt,
            IsDeleted = attachment.IsDeleted,
        };
    }

    /// <summary>
    /// Creates a clone of a TotpCode entity to avoid modifying EF-tracked entities.
    /// </summary>
    /// <param name="totpCode">The TOTP code to clone.</param>
    /// <returns>A new TotpCode instance with copied values.</returns>
    private static TotpCode CloneTotpCode(TotpCode totpCode)
    {
        return new TotpCode
        {
            Id = totpCode.Id,
            Name = totpCode.Name,
            SecretKey = totpCode.SecretKey,
            ItemId = totpCode.ItemId,
            CreatedAt = totpCode.CreatedAt,
            UpdatedAt = totpCode.UpdatedAt,
            IsDeleted = totpCode.IsDeleted,
        };
    }

    /// <summary>
    /// Creates a clone of a Passkey entity to avoid modifying EF-tracked entities.
    /// </summary>
    /// <param name="passkey">The passkey to clone.</param>
    /// <returns>A new Passkey instance with copied values.</returns>
    private static Passkey ClonePasskey(Passkey passkey)
    {
        return new Passkey
        {
            Id = passkey.Id,
            RpId = passkey.RpId,
            UserHandle = passkey.UserHandle,
            PublicKey = passkey.PublicKey,
            PrivateKey = passkey.PrivateKey,
            PrfKey = passkey.PrfKey,
            DisplayName = passkey.DisplayName,
            AdditionalData = passkey.AdditionalData,
            ItemId = passkey.ItemId,
            CreatedAt = passkey.CreatedAt,
            UpdatedAt = passkey.UpdatedAt,
            IsDeleted = passkey.IsDeleted,
        };
    }
}
