import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import type { ItemField } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { useDb } from '@/context/DbContext';

import FormInputCopyToClipboard from '@/components/form/FormInputCopyToClipboard';
import FieldHistoryModal from '@/components/items/FieldHistoryModal';

type FieldBlockProps = {
  field: ItemField;
  itemId?: string;
  /** Whether to hide the label (useful when label is already shown as section header) */
  hideLabel?: boolean;
}

/**
 * Convert URLs in text to clickable links.
 */
const extractUrls = (text: string): { url: string; start: number; end: number }[] => {
  const urlPattern = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/g;
  const matches: { url: string; start: number; end: number }[] = [];
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    matches.push({
      url: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return matches;
};

/**
 * Dynamic field block component that renders based on field type.
 * Supports all field types with automatic history tracking when enabled.
 */
const FieldBlock: React.FC<FieldBlockProps> = ({ field, itemId, hideLabel = false }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyCount, setHistoryCount] = useState<number>(0);

  /* Get translated label for this field. System fields use fieldLabels.* translations, custom fields use their stored label */
  const label = field.IsCustomField
    ? (field.Label || field.FieldKey)
    : t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey });

  // Check if this field has history enabled
  const hasHistoryEnabled = field.EnableHistory === true;

  // Check if there's actual history available
  useEffect(() => {
    if (hasHistoryEnabled && itemId && dbContext?.sqliteClient) {
      const checkHistory = async (): Promise<void> => {
        if (!dbContext.sqliteClient) return;

        try {
          const history = await dbContext.sqliteClient.items.getFieldHistory(itemId, field.FieldKey);
          setHistoryCount(history.length);
        } catch (error) {
          console.error('[FieldBlock] Error checking history:', error);
        }
      };

      void checkHistory();
    }
  }, [hasHistoryEnabled, itemId, field.FieldKey, dbContext?.sqliteClient]);

  // Skip rendering if no value
  if (!field.Value || (typeof field.Value === 'string' && field.Value.trim() === '')) {
    return null;
  }

  const values = Array.isArray(field.Value) ? field.Value : [field.Value];

  const styles = StyleSheet.create({
    container: {
      // Used for TextArea wrapper
    },
    historyButton: {
      marginLeft: 4,
      padding: 4,
    },
    textAreaContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 8,
      padding: 12,
    },
    textAreaLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 8,
    },
    textAreaLabelRow: {
      alignItems: 'center',
      flexDirection: 'row',
      marginBottom: 8,
    },
    textAreaText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    linkText: {
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    multiValueContainer: {
      gap: 8,
    },
  });

  /**
   * Render TextArea field type with URL detection.
   */
  const renderTextArea = (value: string): React.ReactNode => {
    const urls = extractUrls(value);

    if (urls.length === 0) {
      // No URLs, render plain text
      return (
        <View>
          {!hideLabel && (
            <View style={styles.textAreaLabelRow}>
              <Text style={styles.textAreaLabel}>{label}</Text>
              {HistoryButton}
            </View>
          )}
          <View style={styles.textAreaContainer}>
            <Text style={styles.textAreaText}>{value}</Text>
          </View>
        </View>
      );
    }

    // Build text segments with clickable URLs
    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

    urls.forEach((urlMatch, idx) => {
      // Add text before URL
      if (urlMatch.start > lastEnd) {
        segments.push(
          <Text key={`text-${idx}`} style={styles.textAreaText}>
            {value.substring(lastEnd, urlMatch.start)}
          </Text>
        );
      }

      // Add clickable URL
      const href = urlMatch.url.startsWith('http') ? urlMatch.url : `http://${urlMatch.url}`;
      segments.push(
        <Text
          key={`url-${idx}`}
          style={[styles.textAreaText, styles.linkText]}
          onPress={() => Linking.openURL(href)}
        >
          {urlMatch.url}
        </Text>
      );

      lastEnd = urlMatch.end;
    });

    // Add remaining text after last URL
    if (lastEnd < value.length) {
      segments.push(
        <Text key="text-end" style={styles.textAreaText}>
          {value.substring(lastEnd)}
        </Text>
      );
    }

    return (
      <View>
        {!hideLabel && (
          <View style={styles.textAreaLabelRow}>
            <Text style={styles.textAreaLabel}>{label}</Text>
            {HistoryButton}
          </View>
        )}
        <View style={styles.textAreaContainer}>
          <Text>{segments}</Text>
        </View>
      </View>
    );
  };

  /**
   * Render history button if history is available.
   */
  const HistoryButton = historyCount > 0 && itemId ? (
    <TouchableOpacity
      style={styles.historyButton}
      onPress={() => setShowHistoryModal(true)}
      accessibilityLabel={t('items.viewHistory')}
    >
      <MaterialIcons
        name="history"
        size={18}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  ) : null;

  /**
   * Render history modal.
   */
  const HistoryModal = showHistoryModal && itemId ? (
    <FieldHistoryModal
      isOpen={showHistoryModal}
      onClose={() => setShowHistoryModal(false)}
      itemId={itemId}
      fieldKey={field.FieldKey}
      fieldLabel={label}
      fieldType={field.FieldType}
      isHidden={field.IsHidden}
    />
  ) : null;

  // Handle multi-value fields (like multiple URLs)
  if (values.length > 1) {
    return (
      <View style={styles.multiValueContainer}>
        {values.map((value, idx) => (
          <FormInputCopyToClipboard
            key={`${field.FieldKey}-${idx}`}
            label={hideLabel ? '' : (idx === 0 ? label : `${label} ${idx + 1}`)}
            value={value}
            type={field.FieldType === FieldTypes.Password || field.IsHidden ? 'password' : 'text'}
            labelSuffix={idx === 0 ? HistoryButton : undefined}
          />
        ))}
        {HistoryModal}
      </View>
    );
  }

  const value = values[0];

  // Render based on field type
  switch (field.FieldType) {
    case FieldTypes.Password:
    case FieldTypes.Hidden:
      return (
        <>
          <FormInputCopyToClipboard
            label={hideLabel ? '' : label}
            value={value}
            type="password"
            labelSuffix={HistoryButton}
          />
          {HistoryModal}
        </>
      );

    case FieldTypes.TextArea:
      return (
        <View style={styles.container}>
          {renderTextArea(value)}
          {HistoryModal}
        </View>
      );

    case FieldTypes.Email:
    case FieldTypes.URL:
    case FieldTypes.Phone:
    case FieldTypes.Date:
    case FieldTypes.Number:
    case FieldTypes.Text:
    default:
      return (
        <>
          <FormInputCopyToClipboard
            label={hideLabel ? '' : label}
            value={value}
            type="text"
            labelSuffix={HistoryButton}
          />
          {HistoryModal}
        </>
      );
  }
};

export default FieldBlock;
