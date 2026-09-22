import { logoSourceTranslationKey } from '@aliasvault/client/items/ItemLogoView';
import { getAllAppIconKeys } from '@aliasvault/models/icons';
import { LogoKinds } from '@aliasvault/models/vault';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { DisplayItem } from '@/utils/DisplayItem';
import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { appIconComponents } from '@/components/items/AppIconComponents';
import { ItemIcon } from '@/components/items/ItemIcon';

import type { ItemLogo, LogoSelection } from '@aliasvault/models/vault';

type LogoPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: DisplayItem;
  currentLogo?: ItemLogo;
  websiteSource?: string | null;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

const COLUMNS = 4;

/**
 * Lets the user change an item's icon.
 */
export const LogoPickerModal: React.FC<LogoPickerModalProps> = ({ isOpen, onClose, item, currentLogo, websiteSource, onSelect, onFetchFromWebsite }) => {
  const { t } = useTranslation();
  const colors = useColors();

  /**
   * Apply a choice and close.
   */
  const choose = useCallback((selection: LogoSelection): void => {
    HapticsUtility.selection();
    if (selection.Kind === LogoKinds.Favicon) {
      onFetchFromWebsite();
    } else {
      onSelect(selection);
    }
    onClose();
  }, [onFetchFromWebsite, onSelect, onClose]);

  /**
   * Describe a logo: a library icon by its name, any other by where it comes from.
   */
  const describe = (logo: ItemLogo | undefined): string => {
    return logo?.Kind === LogoKinds.Builtin ? t(`items.logo.builtin.${logo.Source}`) : t(logoSourceTranslationKey(logo), { domain: logo?.Source });
  };

  const styles = StyleSheet.create({
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    closeButton: {
      padding: 4,
    },
    currentRow: {
      alignItems: 'center',
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    previewIconFrame: {
      alignItems: 'center',
      backgroundColor: colors.modalSurface,
      borderRadius: 8,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    previewIcon: {
      borderRadius: 6,
      height: 30,
      width: 30,
    },
    previewText: {
      flex: 1,
    },
    previewCaption: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
      textTransform: 'uppercase',
    },
    previewSource: {
      color: colors.text,
      fontSize: 14,
      marginTop: 2,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '500',
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
    },
    cell: {
      padding: 4,
      width: `${100 / COLUMNS}%`,
    },
    tile: {
      alignItems: 'center',
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 10,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 76,
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    tileLabel: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 6,
      textAlign: 'center',
    },
    fetchButton: {
      alignItems: 'center',
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    fetchButtonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    fetchButtonSource: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
  });

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} showHeaderBorder={false} showFooterBorder={false} closeOnBackdropPress scrollable maxScrollHeight={560}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('items.logo.chooseLogo')}</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={8}>
          <MaterialIcons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* What the item shows now; a tap below replaces it once the item is saved. */}
      <View style={styles.currentRow}>
        <View style={styles.previewIconFrame}>
          <ItemIcon item={{ ...item, LogoInfo: currentLogo }} style={styles.previewIcon} />
        </View>
        <View style={styles.previewText}>
          <Text style={styles.previewCaption}>{t('items.logo.currentLogo')}</Text>
          <Text style={styles.previewSource} numberOfLines={1}>{describe(currentLogo)}</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>{t('items.logo.builtinLogos')}</Text>
      <View style={styles.grid}>
        {getAllAppIconKeys().map(key => {
          const Icon = appIconComponents[key];
          return (
            <View key={key} style={styles.cell}>
              <TouchableOpacity
                style={styles.tile}
                onPress={() => choose({ Kind: LogoKinds.Builtin, Source: key })}
                accessibilityRole="button"
                accessibilityLabel={t(`items.logo.builtin.${key}`)}
                testID={`logo-builtin-${key}`}
              >
                <Icon width={32} height={32} />
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {t(`items.logo.builtin.${key}`)}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* Only offered when the URL field contains a valid value. */}
      {websiteSource && (
        <TouchableOpacity style={styles.fetchButton} onPress={() => choose({ Kind: LogoKinds.Favicon })} accessibilityRole="button" testID="logo-fetch-from-website">
          <MaterialIcons name="language" size={22} color={colors.tint} />
          <View style={styles.previewText}>
            <Text style={styles.fetchButtonText}>
              {currentLogo?.Kind === LogoKinds.Favicon ? t('items.logo.refetchFromWebsite') : t('items.logo.fetchFromWebsite')}
            </Text>
            <Text style={styles.fetchButtonSource} numberOfLines={1}>{t('items.logo.sourceFavicon', { domain: websiteSource })}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </ModalWrapper>
  );
};

export default LogoPickerModal;
