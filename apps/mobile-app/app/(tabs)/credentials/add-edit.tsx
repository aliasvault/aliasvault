import { Buffer } from 'buffer';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { yupResolver } from '@hookform/resolvers/yup';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Resolver, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, Keyboard, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Toast from 'react-native-toast-message';

import { CreateIdentityGenerator, IdentityGenerator, IdentityHelperUtils } from '@/utils/dist/shared/identity-generator';
import type { Attachment, Credential } from '@/utils/dist/shared/models/vault';
import type { FaviconExtractModel } from '@/utils/dist/shared/models/webapi';
import { CreatePasswordGenerator, PasswordGenerator } from '@/utils/dist/shared/password-generator';
import emitter from '@/utils/EventEmitter';
import { extractServiceNameFromUrl } from '@/utils/UrlUtility';
import { createCredentialSchema } from '@/utils/ValidationSchema';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { AttachmentUploader } from '@/components/credentials/details/AttachmentUploader';
import { AdvancedPasswordField } from '@/components/form/AdvancedPasswordField';
import { EmailDomainField } from '@/components/form/EmailDomainField';
import { ValidatedFormField, ValidatedFormFieldRef } from '@/components/form/ValidatedFormField';
import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { AliasVaultToast } from '@/components/Toast';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

type CredentialMode = 'random' | 'manual';

/**
 * Add or edit a credential screen.
 */
export default function AddEditCredentialScreen() : React.ReactNode {
  const { id, serviceUrl } = useLocalSearchParams<{ id: string, serviceUrl?: string }>();
  const router = useRouter();
  const colors = useColors();
  const dbContext = useDb();
  const authContext = useAuth();
  const [mode, setMode] = useState<CredentialMode>('random');
  const { executeVaultMutation, syncStatus } = useVaultMutate();
  const navigation = useNavigation();
  const webApi = useWebApi();
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const serviceNameRef = useRef<ValidatedFormFieldRef>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaveDisabled, setIsSaveDisabled] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [originalAttachmentIds, setOriginalAttachmentIds] = useState<string[]>([]);
  const { t } = useTranslation();

  // Track last generated values to avoid overwriting manual entries
  const [lastGeneratedValues, setLastGeneratedValues] = useState<{
    username: string | null;
    password: string | null;
    email: string | null;
  }>({ username: null, password: null, email: null });

  const { control, handleSubmit, setValue, watch } = useForm<Credential>({
    resolver: yupResolver(createCredentialSchema(t)) as Resolver<Credential>,
    defaultValues: {
      Id: "",
      Username: "",
      Password: "",
      ServiceName: "",
      ServiceUrl: "https://",
      Notes: "",
      Alias: {
        FirstName: "",
        LastName: "",
        NickName: "",
        BirthDate: "",
        Gender: undefined,
        Email: ""
      }
    }
  });

  /**
   * If we received an ID, we're in edit mode.
   */
  const isEditMode = id !== undefined && id.length > 0;

  /**
   * Load an existing credential from the database in edit mode.
   */
  const loadExistingCredential = useCallback(async () : Promise<void> => {
    try {
      const existingCredential = await dbContext.sqliteClient!.getCredentialById(id);
      if (existingCredential) {
        existingCredential.Alias.BirthDate = IdentityHelperUtils.normalizeBirthDateForDisplay(existingCredential.Alias.BirthDate);
        Object.entries(existingCredential).forEach(([key, value]) => {
          setValue(key as keyof Credential, value);
        });
        if (existingCredential.Alias?.FirstName || existingCredential.Alias?.LastName) {
          setMode('manual');
        }

        // Load attachments for this credential
        const credentialAttachments = await dbContext.sqliteClient!.getAttachmentsForCredential(id);
        setAttachments(credentialAttachments);
        setOriginalAttachmentIds(credentialAttachments.map(a => a.Id));
      }
    } catch (err) {
      console.error('Error loading credential:', err);
      Toast.show({
        type: 'error',
        text1: t('credentials.errors.loadFailed'),
        text2: t('auth.errors.enterPassword')
      });
    }
  }, [id, dbContext.sqliteClient, setValue, t]);

  /**
   * On mount, load an existing credential if we're in edit mode, or extract the service name from the service URL
   * if we're in add mode and the service URL is provided (by native autofill component).
   */
  useEffect(() => {
    /**
     * Initialize the component by loading settings and handling initial state.
     */
    const initializeComponent = async (): Promise<void> => {
      if (authContext.isOffline) {
        // Show toast and close the modal
        setTimeout(() => {
          Toast.show({
            type: 'error',
            text1: t('credentials.offlineMessage'),
            position: 'bottom'
          });
        }, 100);
        router.dismiss();
        return;
      }

      if (isEditMode) {
        loadExistingCredential();
      } else if (serviceUrl) {
        const decodedUrl = decodeURIComponent(serviceUrl);
        const serviceName = extractServiceNameFromUrl(decodedUrl);
        setValue('ServiceUrl', decodedUrl);
        setValue('ServiceName', serviceName);
      }

      // On create mode, focus the service name field after a short delay to ensure the component is mounted
      if (!isEditMode) {
        setTimeout(() => {
          serviceNameRef.current?.focus();
        }, 100);
      }
    };

    initializeComponent();
  }, [id, isEditMode, serviceUrl, loadExistingCredential, setValue, authContext.isOffline, router, t, dbContext.sqliteClient]);

  /**
   * Initialize the identity and password generators with settings from user's vault.
   * @returns {identityGenerator: IIdentityGenerator, passwordGenerator: PasswordGenerator}
   */
  const initializeGenerators = useCallback(async () : Promise<{ identityGenerator: IdentityGenerator, passwordGenerator: PasswordGenerator }> => {
    // Get default identity language from database
    const identityLanguage = await dbContext.sqliteClient!.getDefaultIdentityLanguage();

    // Initialize identity generator based on language
    const identityGenerator = CreateIdentityGenerator(identityLanguage);

    // Initialize password generator with settings from vault
    const passwordSettings = await dbContext.sqliteClient!.getPasswordSettings();
    const passwordGenerator = CreatePasswordGenerator(passwordSettings);

    return { identityGenerator, passwordGenerator };
  }, [dbContext.sqliteClient]);

  /**
   * Generate a random alias and password.
   */
  const generateRandomAlias = useCallback(async (): Promise<void> => {
    const { identityGenerator, passwordGenerator } = await initializeGenerators();

    // Get gender preference from database
    const genderPreference = await dbContext.sqliteClient!.getDefaultIdentityGender();

    // Generate identity with gender preference
    const identity = identityGenerator.generateRandomIdentity(genderPreference);

    const password = passwordGenerator.generateRandomPassword();
    const defaultEmailDomain = await dbContext.sqliteClient!.getDefaultEmailDomain();
    const email = defaultEmailDomain ? `${identity.emailPrefix}@${defaultEmailDomain}` : identity.emailPrefix;

    // Check current values
    const currentUsername = watch('Username') ?? '';
    const currentPassword = watch('Password') ?? '';
    const currentEmail = watch('Alias.Email') ?? '';

    // Only overwrite email if it's empty or matches the last generated value
    if (!currentEmail || currentEmail === lastGeneratedValues.email) {
      setValue('Alias.Email', email);
    }
    setValue('Alias.FirstName', identity.firstName);
    setValue('Alias.LastName', identity.lastName);
    setValue('Alias.NickName', identity.nickName);
    setValue('Alias.Gender', identity.gender);
    setValue('Alias.BirthDate', IdentityHelperUtils.normalizeBirthDateForDisplay(identity.birthDate.toISOString()));

    // Only overwrite username if it's empty or matches the last generated value
    if (!currentUsername || currentUsername === lastGeneratedValues.username) {
      setValue('Username', identity.nickName);
    }

    // Only overwrite password if it's empty or matches the last generated value
    if (!currentPassword || currentPassword === lastGeneratedValues.password) {
      setValue('Password', password);
      // Make password visible when newly generated
      setIsPasswordVisible(true);
    }

    // Update tracking with new generated values
    setLastGeneratedValues({
      username: identity.nickName,
      password: password,
      email: email
    });
  }, [watch, setValue, setIsPasswordVisible, initializeGenerators, dbContext.sqliteClient, lastGeneratedValues, setLastGeneratedValues]);

  /**
   * Clear all alias fields.
   */
  const clearAliasFields = useCallback(() => {
    setValue('Alias.FirstName', '');
    setValue('Alias.LastName', '');
    setValue('Alias.NickName', '');
    setValue('Alias.Gender', '');
    setValue('Alias.BirthDate', '');
  }, [setValue]);

  /**
   * Check if any alias fields have values.
   */
  const hasAliasValues = watch('Alias.FirstName') || watch('Alias.LastName') || watch('Alias.NickName') || watch('Alias.Gender') || watch('Alias.BirthDate');

  /**
   * Handle the generate random alias button press.
   */
  const handleGenerateRandomAlias = useCallback(async (): Promise<void> => {
    // Trigger haptic feedback when pull-to-refresh is activated
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (hasAliasValues) {
      clearAliasFields();
    } else {
      await generateRandomAlias();
    }
  }, [generateRandomAlias, clearAliasFields, hasAliasValues]);

  /**
   * Submit the form for either creating or updating a credential.
   * @param {Credential} data - The form data.
   */
  const onSubmit = useCallback(async (data: Credential) : Promise<void> => {
    // Prevent multiple submissions
    if (isSaveDisabled) {
      return;
    }

    // Disable save button to prevent multiple submissions
    setIsSaveDisabled(true);

    Keyboard.dismiss();

    setIsSyncing(true);

    // Assemble the credential to save
    const credentialToSave: Credential = {
      Id: isEditMode ? id : '',
      Username: data.Username,
      Password: data.Password,
      ServiceName: data.ServiceName,
      ServiceUrl: (data.ServiceUrl === 'http://' || data.ServiceUrl === 'https://') ? '' : data.ServiceUrl,
      Notes: data.Notes,
      Alias: {
        FirstName: data.Alias.FirstName,
        LastName: data.Alias.LastName,
        NickName: data.Alias.NickName,
        BirthDate: data.Alias.BirthDate,
        Gender: data.Alias.Gender,
        Email: data.Alias.Email
      }
    }

    // If we're creating a new credential and mode is random, generate random values here
    if (!isEditMode && mode === 'random') {
      // Generate random values now and then read them from the form fields to manually assign to the credentialToSave object
      await generateRandomAlias();
      credentialToSave.Username = watch('Username');
      credentialToSave.Password = watch('Password');
      credentialToSave.ServiceName = watch('ServiceName');
      const serviceUrl = watch('ServiceUrl');
      credentialToSave.ServiceUrl = (serviceUrl === 'http://' || serviceUrl === 'https://') ? '' : serviceUrl;
      credentialToSave.Notes = watch('Notes');
      credentialToSave.Alias.FirstName = watch('Alias.FirstName');
      credentialToSave.Alias.LastName = watch('Alias.LastName');
      credentialToSave.Alias.NickName = watch('Alias.NickName');
      credentialToSave.Alias.BirthDate = watch('Alias.BirthDate');
      credentialToSave.Alias.Gender = watch('Alias.Gender');
      credentialToSave.Alias.Email = watch('Alias.Email');
    }

    // Convert user birthdate entry format (yyyy-mm-dd) into valid ISO 8601 format for database storage
    credentialToSave.Alias.BirthDate = IdentityHelperUtils.normalizeBirthDateForDb(credentialToSave.Alias.BirthDate);

    // Extract favicon from service URL if the credential has one
    if (credentialToSave.ServiceUrl) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Favicon extraction timed out')), 5000)
        );

        const faviconPromise = webApi.get<FaviconExtractModel>('Favicon/Extract?url=' + credentialToSave.ServiceUrl);
        const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]) as FaviconExtractModel;
        if (faviconResponse?.image) {
          const decodedImage = Uint8Array.from(Buffer.from(faviconResponse.image as string, 'base64'));
          credentialToSave.Logo = decodedImage;
        }
      } catch {
        // Favicon extraction failed or timed out, this is not a critical error so we can ignore it.
      }
    }

    await executeVaultMutation(async () => {
      if (isEditMode) {
        await dbContext.sqliteClient!.updateCredentialById(credentialToSave, originalAttachmentIds, attachments);
      } else {
        const credentialId = await dbContext.sqliteClient!.createCredential(credentialToSave, attachments);
        credentialToSave.Id = credentialId;
      }

      // Emit an event to notify list and detail views to refresh
      emitter.emit('credentialChanged', credentialToSave.Id);
    },
    {
      /**
       * Handle successful vault mutation.
       */
      onSuccess: () => {
        // If this was created from autofill (serviceUrl param), show confirmation screen
        if (serviceUrl && !isEditMode) {
          router.replace('/credentials/autofill-credential-created');
        } else {
          // First close the modal
          router.dismiss();

          // Then navigate after a short delay to ensure the modal has closed
          setTimeout(() => {
            if (isEditMode) {
              Toast.show({
                type: 'success',
                text1: t('credentials.toasts.credentialUpdated'),
                position: 'bottom'
              });

              // Do not navigate away, the original screen will update itself after modal is closed.
            } else {
              Toast.show({
                type: 'success',
                text1: t('credentials.toasts.credentialSaved'),
                position: 'bottom'
              });

              router.push(`/credentials/${credentialToSave.Id}`);
            }
          }, 100);
        }
      },
      /**
       * Handle error during vault mutation.
       */
      onError: (error) => {
        Toast.show({
          type: 'error',
          text1: t('credentials.errors.saveFailed'),
          text2: error.message,
          position: 'bottom'
        });
        console.error('Error saving credential:', error.message);
      }
    });

    setIsSyncing(false);
    setIsSaveDisabled(false);
  }, [isEditMode, id, serviceUrl, router, executeVaultMutation, dbContext.sqliteClient, mode, generateRandomAlias, webApi, watch, setIsSaveDisabled, setIsSyncing, isSaveDisabled, t, originalAttachmentIds, attachments]);

  /**
   * Generate a random username.
   */
  const generateRandomUsername = async () : Promise<void> => {
    try {
      const { identityGenerator } = await initializeGenerators();

      // Get gender preference from database
      const genderPreference = await dbContext.sqliteClient!.getDefaultIdentityGender();

      // Generate identity with gender preference
      const identity = identityGenerator.generateRandomIdentity(genderPreference);

      // Only overwrite username if it's empty or matches the last generated value
      const currentUsername = watch('Username') ?? '';
      if (!currentUsername || currentUsername === lastGeneratedValues.username) {
        setValue('Username', identity.nickName);
        // Update the tracking for username
        setLastGeneratedValues(prev => ({ ...prev, username: identity.nickName }));
      }
    } catch (error) {
      console.error('Error generating random username:', error);
      Toast.show({
        type: 'error',
        text1: t('credentials.errors.generateUsernameFailed'),
        text2: t('auth.errors.enterPassword')
      });
    }
  };

  /**
   * Handle the delete button press.
   */
  const handleDelete = async () : Promise<void> => {
    if (!id) {
      return;
    }

    Keyboard.dismiss();

    Alert.alert(
      t('credentials.deleteCredential'),
      t('credentials.deleteConfirm'),
      [
        {
          text: t('common.cancel'),
          style: "cancel"
        },
        {
          text: t('common.delete'),
          style: "destructive",
          /**
           * Delete the credential.
           */
          onPress: async () : Promise<void> => {
            setIsSyncing(true);

            await executeVaultMutation(async () => {
              await dbContext.sqliteClient!.deleteCredentialById(id);
            });

            // Show success toast
            setTimeout(() => {
              Toast.show({
                type: 'success',
                text1: t('credentials.toasts.credentialDeleted'),
                position: 'bottom'
              });
            }, 200);

            setIsSyncing(false);

            /*
             * Navigate back to the root of the navigation stack.
             * On Android, we need to go back twice since we're two levels deep.
             * On iOS, this will dismiss the modal.
             */
            router.back();
            router.back();
          }
        }
      ]
    );
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: Platform.OS === 'ios' ? 52 : 0,
    },
    contentContainer: {
      paddingBottom: 40,
      paddingTop: 16,
    },
    deleteButton: {
      alignItems: 'center',
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
      borderRadius: 8,
      borderWidth: 1,
      padding: 10,
    },
    deleteButtonText: {
      color: colors.errorText,
      fontWeight: '600',
    },
    generateButton: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    generateButtonPrimary: {
      backgroundColor: colors.primary,
    },
    generateButtonSecondary: {
      backgroundColor: colors.textMuted,
    },
    generateButtonText: {
      color: colors.primarySurfaceText,
      fontWeight: '600',
      marginLeft: 6,
    },
    headerLeftButton: {
      padding: 10,
      paddingLeft: 0,
    },
    headerLeftButtonText: {
      color: colors.primary,
    },
    headerRightButton: {
      padding: 10,
    },
    headerRightButtonDisabled: {
      opacity: 0.5,
    },
    keyboardContainer: {
      flex: 1,
    },
    modeButton: {
      alignItems: 'center',
      borderRadius: 6,
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      padding: 8,
    },
    modeButtonActive: {
      backgroundColor: colors.primary,
    },
    modeButtonText: {
      color: colors.text,
      fontWeight: '600',
    },
    modeButtonTextActive: {
      color: colors.primarySurfaceText,
    },
    modeSelector: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      marginBottom: 16,
      padding: 4,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 24,
      padding: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 10,
    },
  });

  // Set header buttons
  useEffect(() => {
    navigation.setOptions({
      /**
       * Header left button (iOS only).
       */
      ...(Platform.OS === 'ios' && {
        /**
         * Header left button.
         */
        headerLeft: () : React.ReactNode => (
          <RobustPressable
            onPress={() => router.back()}
            style={styles.headerLeftButton}
          >
            <ThemedText style={styles.headerLeftButtonText}>{t('common.cancel')}</ThemedText>
          </RobustPressable>
        ),
      }),
      /**
       * Header right button.
       */
      headerRight: () => (
        <RobustPressable
          onPress={handleSubmit(onSubmit)}
          style={[styles.headerRightButton, isSaveDisabled && styles.headerRightButtonDisabled]}
          disabled={isSaveDisabled}
        >
          <MaterialIcons
            name="save"
            size={Platform.OS === 'android' ? 24 : 22}
            color={colors.primary}
          />
        </RobustPressable>
      ),
    });
  }, [navigation, mode, handleSubmit, onSubmit, colors.primary, isEditMode, router, styles.headerLeftButton, styles.headerLeftButtonText, styles.headerRightButton, styles.headerRightButtonDisabled, isSaveDisabled, t]);

  return (
    <>
      <Stack.Screen options={{ title: isEditMode ? t('credentials.editCredential') : t('credentials.addCredential') }} />
      {(isSyncing) && (
        <LoadingOverlay status={syncStatus} />
      )}

      <ThemedContainer style={styles.container}>
        <KeyboardAwareScrollView
          enabled={true}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          bottomOffset={30}
        >
          {!isEditMode && (
            <View style={styles.modeSelector}>
              <RobustPressable
                style={[styles.modeButton, mode === 'random' && styles.modeButtonActive]}
                onPress={() => setMode('random')}
              >
                <MaterialIcons
                  name="auto-fix-high"
                  size={20}
                  color={mode === 'random' ? colors.primarySurfaceText : colors.text}
                />
                <ThemedText style={[styles.modeButtonText, mode === 'random' && styles.modeButtonTextActive]}>
                  {t('credentials.randomAlias')}
                </ThemedText>
              </RobustPressable>
              <RobustPressable
                style={[styles.modeButton, mode === 'manual' && styles.modeButtonActive]}
                onPress={() => setMode('manual')}
              >
                <MaterialIcons
                  name="person"
                  size={20}
                  color={mode === 'manual' ? colors.primarySurfaceText : colors.text}
                />
                <ThemedText style={[styles.modeButtonText, mode === 'manual' && styles.modeButtonTextActive]}>
                  {t('credentials.manual')}
                </ThemedText>
              </RobustPressable>
            </View>
          )}

          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>{t('credentials.service')}</ThemedText>
            <ValidatedFormField
              ref={serviceNameRef}
              control={control}
              name="ServiceName"
              label={t('credentials.serviceName')}
              required
            />
            <ValidatedFormField
              control={control}
              name="ServiceUrl"
              label={t('credentials.serviceUrl')}
            />
          </View>
          {(mode === 'manual' || isEditMode) && (
            <>
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('credentials.loginCredentials')}</ThemedText>

                <EmailDomainField
                  value={watch('Alias.Email') ?? ''}
                  onChange={(newValue) => setValue('Alias.Email', newValue)}
                  label={t('credentials.email')}
                />
                <ValidatedFormField
                  control={control}
                  name="Username"
                  label={t('credentials.username')}
                  buttons={[
                    {
                      icon: "refresh",
                      onPress: generateRandomUsername
                    }
                  ]}
                />
                <AdvancedPasswordField
                  control={control}
                  name="Password"
                  label={t('credentials.password')}
                  showPassword={isPasswordVisible}
                  onShowPasswordChange={setIsPasswordVisible}
                  isNewCredential={!isEditMode}
                />
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('credentials.alias')}</ThemedText>
                <RobustPressable
                  style={[
                    styles.generateButton,
                    hasAliasValues ? styles.generateButtonSecondary : styles.generateButtonPrimary
                  ]}
                  onPress={handleGenerateRandomAlias}
                >
                  <MaterialIcons
                    name={hasAliasValues ? "clear" : "auto-fix-high"}
                    size={20}
                    color="#fff"
                  />
                  <ThemedText style={styles.generateButtonText}>
                    {hasAliasValues ? t('credentials.clearAliasFields') : t('credentials.generateRandomAlias')}
                  </ThemedText>
                </RobustPressable>
                <ValidatedFormField
                  control={control}
                  name="Alias.FirstName"
                  label={t('credentials.firstName')}
                />
                <ValidatedFormField
                  control={control}
                  name="Alias.LastName"
                  label={t('credentials.lastName')}
                />
                <ValidatedFormField
                  control={control}
                  name="Alias.NickName"
                  label={t('credentials.nickName')}
                />
                <ValidatedFormField
                  control={control}
                  name="Alias.Gender"
                  label={t('credentials.gender')}
                />
                <ValidatedFormField
                  control={control}
                  name="Alias.BirthDate"
                  label={t('credentials.birthDate')}
                  placeholder={t('credentials.birthDatePlaceholder')}
                />
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('credentials.metadata')}</ThemedText>

                <ValidatedFormField
                  control={control}
                  name="Notes"
                  label={t('credentials.notes')}
                  multiline={true}
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                {/* TODO: Add TOTP management */}
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('credentials.attachments')}</ThemedText>

                <AttachmentUploader
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                />
              </View>

              {isEditMode && (
                <RobustPressable
                  style={styles.deleteButton}
                  onPress={handleDelete}
                >
                  <ThemedText style={styles.deleteButtonText}>{t('credentials.deleteCredential')}</ThemedText>
                </RobustPressable>
              )}
            </>
          )}
        </KeyboardAwareScrollView>
      </ThemedContainer>
      <AliasVaultToast />
    </>
  );
}