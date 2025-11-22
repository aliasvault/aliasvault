import { Buffer } from 'buffer';

import { yupResolver } from '@hookform/resolvers/yup';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';
import * as Yup from 'yup';

import AttachmentUploader from '@/entrypoints/popup/components/Credentials/Details/AttachmentUploader';
import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import EmailDomainField from '@/entrypoints/popup/components/Forms/EmailDomainField';
import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import PasswordField from '@/entrypoints/popup/components/Forms/PasswordField';
import UsernameField from '@/entrypoints/popup/components/Forms/UsernameField';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { SKIP_FORM_RESTORE_KEY } from '@/utils/Constants';
import { IdentityHelperUtils, CreateIdentityGenerator, CreateUsernameEmailGenerator, Identity, Gender, convertAgeRangeToBirthdateOptions } from '@/utils/dist/shared/identity-generator';
import type { Attachment, Credential } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';

import { browser } from '#imports';

type CredentialMode = 'random' | 'manual';

// Persisted form data type used for JSON serialization.
type PersistedFormData = {
  credentialId: string | null;
  mode: CredentialMode;
  formValues: Omit<Credential, 'Logo'> & { Logo?: string | null };
}

/**
 * Add or edit credential page.
 */
const CredentialAddEdit: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const dbContext = useDb();
  // If we received an ID, we're in edit mode
  const isEditMode = id !== undefined && id.length > 0;

  /**
   * Validation schema for the credential form with translatable messages.
   */
  const credentialSchema = useMemo(() => Yup.object().shape({
    Id: Yup.string(),
    ServiceName: Yup.string().required(t('credentials.validation.serviceNameRequired')),
    ServiceUrl: Yup.string().nullable().optional(),
    Alias: Yup.object().shape({
      FirstName: Yup.string().nullable().optional(),
      LastName: Yup.string().nullable().optional(),
      NickName: Yup.string().nullable().optional(),
      BirthDate: Yup.string()
        .nullable()
        .optional()
        .test(
          'is-valid-date-format',
          t('credentials.validation.invalidDateFormat'),
          value => {
            if (!value) {
              return true;
            }
            return /^\d{4}-\d{2}-\d{2}$/.test(value);
          },
        ),
      Gender: Yup.string().nullable().optional(),
      Email: Yup.string().email(t('credentials.validation.invalidEmail')).nullable().optional()
    }),
    Username: Yup.string().nullable().optional(),
    Password: Yup.string().nullable().optional(),
    Notes: Yup.string().nullable().optional()
  }), [t]);

  const { executeVaultMutation, isLoading, syncStatus } = useVaultMutate();
  const [mode, setMode] = useState<CredentialMode>('random');
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const [localLoading, setLocalLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(!isEditMode);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [originalAttachmentIds, setOriginalAttachmentIds] = useState<string[]>([]);
  const [passkeyMarkedForDeletion, setPasskeyMarkedForDeletion] = useState(false);
  const webApi = useWebApi();

  // Track last generated values to avoid overwriting manual entries
  const [lastGeneratedValues, setLastGeneratedValues] = useState<{
    username: string | null;
    password: string | null;
    email: string | null;
  }>({ username: null, password: null, email: null });

  const serviceNameRef = useRef<HTMLInputElement>(null);

  const { handleSubmit, setValue, watch, formState: { errors } } = useForm<Credential>({
    resolver: yupResolver(credentialSchema as Yup.ObjectSchema<Credential>),
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
   * Persists the current form values to storage
   * @returns Promise that resolves when the form values are persisted
   */
  const persistFormValues = useCallback(async (): Promise<void> => {
    if (localLoading) {
      // Do not persist values if the page is still loading.
      return;
    }

    const formValues = watch();
    const persistedData: PersistedFormData = {
      credentialId: id || null,
      mode,
      formValues: {
        ...formValues,
        Logo: null // Don't persist the Logo field as it can't be user modified in the UI.
      }
    };
    await sendMessage('PERSIST_FORM_VALUES', JSON.stringify(persistedData), 'background');
  }, [watch, id, mode, localLoading]);

  /**
   * Watch for mode changes and persist form values
   */
  useEffect(() => {
    if (!localLoading) {
      void persistFormValues();
    }
  }, [mode, persistFormValues, localLoading]);

  // Watch for form changes and persist them
  useEffect(() => {
    const subscription = watch(() => {
      void persistFormValues();
    });
    return (): void => subscription.unsubscribe();
  }, [watch, persistFormValues]);

  /**
   * Loads persisted form values from storage. This is used to keep track of form changes
   * and restore them when the page is reloaded. The browser extension popup will close
   * automatically by clicking outside of the popup, but with this logic we can restore
   * the form values when the page is reloaded so the user can continue their mutation operation.
   *
   * @returns Promise that resolves when the form values are loaded
   */
  const loadPersistedValues = useCallback(async (): Promise<void> => {
    const persistedData = await sendMessage('GET_PERSISTED_FORM_VALUES', null, 'background') as string | null;

    // Try to parse the persisted data as a JSON object.
    try {
      let persistedDataObject: PersistedFormData | null = null;
      try {
        if (persistedData) {
          persistedDataObject = JSON.parse(persistedData) as PersistedFormData;
        }
      } catch (error) {
        console.error('Error parsing persisted data:', error);
      }

      // Check if the object has a value and is not null
      const objectEmpty = persistedDataObject === null || persistedDataObject === undefined;
      if (objectEmpty) {
        // If the persisted data object is empty, we don't have any values to restore and can exit early.
        setLocalLoading(false);
        return;
      }

      const isCurrentPage = persistedDataObject?.credentialId == id;
      if (persistedDataObject && isCurrentPage) {
        // Only restore if the persisted credential ID matches current page
        setMode(persistedDataObject.mode);
        Object.entries(persistedDataObject.formValues).forEach(([key, value]) => {
          setValue(key as keyof Credential, value as Credential[keyof Credential]);
        });
      } else {
        console.error('Persisted values do not match current page');
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }

    // Set local loading state to false which also activates the persisting of form value changes from this point on.
    setLocalLoading(false);
  }, [setValue, id, setMode, setLocalLoading]);

  /**
   * Clears persisted form values from storage
   * @returns Promise that resolves when the form values are cleared
   */
  const clearPersistedValues = useCallback(async (): Promise<void> => {
    await sendMessage('CLEAR_PERSISTED_FORM_VALUES', null, 'background');
  }, []);

  // Clear persisted values when the page is unmounted.
  useEffect(() => {
    return (): void => {
      void clearPersistedValues();
    };
  }, [clearPersistedValues]);

  /**
   * Load an existing credential from the database in edit mode.
   */
  useEffect(() => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    if (!id) {
      // On create mode, check for URL parameters first, then fallback to tab detection
      const urlParams = new URLSearchParams(window.location.search);
      const serviceName = urlParams.get('serviceName');
      const serviceUrl = urlParams.get('serviceUrl');
      const currentUrl = urlParams.get('currentUrl');

      /**
       * Initialize service detection from URL parameters or current tab
       */
      const initializeServiceDetection = async (): Promise<void> => {
        try {
          // If URL parameters are present (e.g., from content script popout), use them
          if (serviceName || serviceUrl || currentUrl) {
            if (serviceName) {
              setValue('ServiceName', decodeURIComponent(serviceName));
            }
            if (serviceUrl) {
              setValue('ServiceUrl', decodeURIComponent(serviceUrl));
            }

            // If we have currentUrl but missing serviceName or serviceUrl, derive them
            if (currentUrl && (!serviceName || !serviceUrl)) {
              const decodedCurrentUrl = decodeURIComponent(currentUrl);
              const serviceInfo = ServiceDetectionUtility.getServiceInfoFromTab(decodedCurrentUrl);

              if (!serviceName && serviceInfo.suggestedNames.length > 0) {
                setValue('ServiceName', serviceInfo.suggestedNames[0]);
              }
              if (!serviceUrl && serviceInfo.serviceUrl) {
                setValue('ServiceUrl', serviceInfo.serviceUrl);
              }
            }
            return;
          }

          // Otherwise, detect from current active tab (for dashboard case)
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

          if (activeTab?.url) {
            const serviceInfo = ServiceDetectionUtility.getServiceInfoFromTab(
              activeTab.url,
              activeTab.title
            );

            if (serviceInfo.suggestedNames.length > 0) {
              setValue('ServiceName', serviceInfo.suggestedNames[0]);
            }
            if (serviceInfo.serviceUrl) {
              setValue('ServiceUrl', serviceInfo.serviceUrl);
            }
          }
        } catch (error) {
          console.error('Error detecting service information:', error);
        }
      };

      initializeServiceDetection();

      // Focus the service name field after a short delay to ensure the component is mounted.
      setTimeout(() => {
        serviceNameRef.current?.focus();
      }, 100);
      setIsInitialLoading(false);

      // Check if we should skip form restoration (e.g., when opened from popout button)
      browser.storage.local.get([SKIP_FORM_RESTORE_KEY]).then((result) => {
        if (result[SKIP_FORM_RESTORE_KEY]) {
          // Clear the flag after using it
          browser.storage.local.remove([SKIP_FORM_RESTORE_KEY]);
          // Don't load persisted values, but set local loading to false
          setLocalLoading(false);
        } else {
          // Load persisted form values normally
          loadPersistedValues();
        }
      });
      return;
    }

    try {
      const result = dbContext.sqliteClient.getCredentialById(id);

      if (result) {
        result.Alias.BirthDate = IdentityHelperUtils.normalizeBirthDateForDisplay(result.Alias.BirthDate);

        // Set form values
        Object.entries(result).forEach(([key, value]) => {
          setValue(key as keyof Credential, value);
        });

        // Load attachments for this credential
        const credentialAttachments = dbContext.sqliteClient.getAttachmentsForCredential(id);
        setAttachments(credentialAttachments);
        setOriginalAttachmentIds(credentialAttachments.map(a => a.Id));

        setMode('manual');
        setIsInitialLoading(false);

        // Check for persisted values that might override the loaded values if they exist.
        loadPersistedValues();
      } else {
        console.error('Credential not found');
        navigate('/credentials');
      }
    } catch (err) {
      console.error('Error loading credential:', err);
      setIsInitialLoading(false);
    }
  }, [dbContext.sqliteClient, id, navigate, setIsInitialLoading, setValue, loadPersistedValues, clearPersistedValues]);

  /**
   * Handle the delete button click.
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!id) {
      return;
    }

    executeVaultMutation(async () => {
      dbContext.sqliteClient!.deleteCredentialById(id);
    }, {
      /**
       * Navigate to the credentials list page on success.
       */
      onSuccess: () => {
        void clearPersistedValues();
        navigate('/credentials');
      }
    });
  }, [id, executeVaultMutation, dbContext.sqliteClient, navigate, clearPersistedValues]);

  /**
   * Initialize the identity and password generators with settings from user's vault.
   */
  const initializeGenerators = useCallback(async () => {
    // Get effective identity language (smart default based on UI language if no explicit override)
    const identityLanguage = await dbContext.sqliteClient!.getEffectiveIdentityLanguage();

    // Initialize identity generator based on language
    const identityGenerator = CreateIdentityGenerator(identityLanguage);

    // Initialize password generator with settings from vault
    const passwordSettings = dbContext.sqliteClient!.getPasswordSettings();
    const passwordGenerator = CreatePasswordGenerator(passwordSettings);

    return { identityGenerator, passwordGenerator };
  }, [dbContext.sqliteClient]);

  /**
   * Generate a random alias and password.
   */
  const generateRandomAlias = useCallback(async () => {
    const { identityGenerator, passwordGenerator } = await initializeGenerators();

    // Get gender preference from database
    const genderPreference = dbContext.sqliteClient!.getDefaultIdentityGender();

    // Get age range preference and convert to birthdate options
    const ageRange = dbContext.sqliteClient!.getDefaultIdentityAgeRange();
    const birthdateOptions = convertAgeRangeToBirthdateOptions(ageRange);

    // Generate identity with gender preference and birthdate options (null is handled by generator)
    const identity = identityGenerator.generateRandomIdentity(genderPreference, birthdateOptions);
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
    }

    // Update tracking with new generated values
    setLastGeneratedValues({
      username: identity.nickName,
      password: password,
      email: email
    });
  }, [watch, setValue, initializeGenerators, dbContext, lastGeneratedValues, setLastGeneratedValues]);

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

  //  Check if any alias fields have values.
  const hasAliasValues = !!(watch('Alias.FirstName') || watch('Alias.LastName') || watch('Alias.NickName') || watch('Alias.Gender') || watch('Alias.BirthDate'));

  /**
   * Handle the generate random alias button press.
   */
  const handleGenerateRandomAlias = useCallback(() => {
    if (hasAliasValues) {
      clearAliasFields();
    } else {
      void generateRandomAlias();
    }
  }, [generateRandomAlias, clearAliasFields, hasAliasValues]);

  const generateRandomUsername = useCallback(async () => {
    try {
      const firstName = watch('Alias.FirstName') ?? '';
      const lastName = watch('Alias.LastName') ?? '';
      const nickName = watch('Alias.NickName') ?? '';
      const birthDate = watch('Alias.BirthDate') ?? '';

      let username: string;

      // If alias fields are empty, generate a completely random username
      if (!firstName && !lastName && !nickName && !birthDate) {
        const { identityGenerator } = await initializeGenerators();
        const genderPreference = dbContext.sqliteClient!.getDefaultIdentityGender();
        const ageRange = dbContext.sqliteClient!.getDefaultIdentityAgeRange();
        const birthdateOptions = convertAgeRangeToBirthdateOptions(ageRange);
        const randomIdentity = identityGenerator.generateRandomIdentity(genderPreference, birthdateOptions);
        username = randomIdentity.nickName;
      } else {
        // Generate username based on current identity fields
        const usernameEmailGenerator = CreateUsernameEmailGenerator();

        let gender = Gender.Other;
        try {
          gender = watch('Alias.Gender') as Gender;
        } catch {
          // Gender parsing failed, default to other.
        }

        // Parse birthDate, fallback to current date if invalid
        let parsedBirthDate = new Date(birthDate);
        if (!birthDate || isNaN(parsedBirthDate.getTime())) {
          parsedBirthDate = new Date();
        }

        const identity: Identity = {
          firstName,
          lastName,
          nickName,
          gender,
          birthDate: parsedBirthDate,
          emailPrefix: watch('Alias.Email') ?? '',
        };

        username = usernameEmailGenerator.generateUsername(identity);
      }

      setValue('Username', username);
      // Update the tracking for username
      setLastGeneratedValues(prev => ({ ...prev, username }));
    } catch (error) {
      console.error('Error generating random username:', error);
    }
  }, [setValue, watch, setLastGeneratedValues, initializeGenerators, dbContext.sqliteClient]);

  /**
   * Handle form submission.
   */
  const onSubmit = useCallback(async (data: Credential): Promise<void> => {
    // Normalize the birth date for database entry.
    let birthdate = data.Alias.BirthDate;
    if (birthdate) {
      birthdate = IdentityHelperUtils.normalizeBirthDateForDb(birthdate);
    }

    // Clean up empty protocol-only URLs
    if (data.ServiceUrl === 'http://' || data.ServiceUrl === 'https://') {
      data.ServiceUrl = '';
    }

    // If we're creating a new credential and mode is random, generate random values here
    if (!isEditMode && mode === 'random') {
      // Generate random values now and then read them from the form fields to manually assign to the credentialToSave object
      await generateRandomAlias();
      data.Username = watch('Username');
      data.Password = watch('Password');
      data.Alias.FirstName = watch('Alias.FirstName');
      data.Alias.LastName = watch('Alias.LastName');
      data.Alias.NickName = watch('Alias.NickName');
      data.Alias.BirthDate = watch('Alias.BirthDate');
      data.Alias.Gender = watch('Alias.Gender');
      data.Alias.Email = watch('Alias.Email');
      // Clean up ServiceUrl for random mode too
      const serviceUrl = watch('ServiceUrl');
      data.ServiceUrl = (serviceUrl === 'http://' || serviceUrl === 'https://') ? '' : serviceUrl;
    }

    // Extract favicon from service URL if the credential has one
    if (data.ServiceUrl) {
      setLocalLoading(true);
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Favicon extraction timed out')), 5000)
        );

        const faviconPromise = webApi.get<{ image: string }>('Favicon/Extract?url=' + data.ServiceUrl);
        const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]) as { image: string };

        if (faviconResponse?.image) {
          const decodedImage = Uint8Array.from(Buffer.from(faviconResponse.image, 'base64'));
          data.Logo = decodedImage;
        }
      } catch {
        // Favicon extraction failed or timed out, this is not a critical error so we can ignore it.
      }
    }

    executeVaultMutation(async () => {
      setLocalLoading(false);

      if (isEditMode) {
        await dbContext.sqliteClient!.updateCredentialById(data, originalAttachmentIds, attachments);

        // Delete passkeys if marked for deletion
        if (passkeyMarkedForDeletion) {
          await dbContext.sqliteClient!.deletePasskeysByCredentialId(data.Id);
        }
      } else {
        const credentialId = await dbContext.sqliteClient!.createCredential(data, attachments);
        data.Id = credentialId.toString();
      }
    }, {
      /**
       * Navigate to the credential details page on success.
       */
      onSuccess: () => {
        void clearPersistedValues();
        // If in add mode, navigate to the credential details page.
        if (!isEditMode) {
          // Navigate to the credential details page.
          navigate(`/credentials/${data.Id}`, { replace: true });
        } else {
          // If in edit mode, pop the current page from the history stack to end up on details page as well.
          navigate(-1);
        }
      },
    });
  }, [isEditMode, dbContext.sqliteClient, executeVaultMutation, navigate, mode, watch, generateRandomAlias, webApi, clearPersistedValues, originalAttachmentIds, attachments, passkeyMarkedForDeletion]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    // Only set the header buttons once on mount.
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {isEditMode && (
          <HeaderButton
            onClick={() => setShowDeleteModal(true)}
            title={t('credentials.deleteCredential')}
            iconType={HeaderIconType.DELETE}
            variant="danger"
          />
        )}
        <HeaderButton
          onClick={handleSubmit(onSubmit)}
          title={t('credentials.saveCredential')}
          iconType={HeaderIconType.SAVE}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => {};
  }, [setHeaderButtons, handleSubmit, onSubmit, isEditMode, t]);

  // Clear header buttons on unmount
  useEffect((): (() => void) => {
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

  if (isEditMode && !watch('ServiceName')) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <button type="submit" style={{ display: 'none' }} />
      {(localLoading || isLoading) && (
        <div className="fixed inset-0 flex flex-col justify-center items-center bg-white dark:bg-gray-900 bg-opacity-90 dark:bg-opacity-90 z-50">
          <LoadingSpinner />
          <div className="text-sm text-gray-500 mt-2">
            {syncStatus}
          </div>
        </div>
      )}

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={() => {
          setShowDeleteModal(false);
          void handleDelete();
        }}
        title={t('credentials.deleteCredentialTitle')}
        message={t('credentials.deleteCredentialConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
      />

      {!isEditMode && (
        <div className="flex space-x-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('random')}
            className={`flex-1 py-2 text-sm px-4 rounded flex items-center justify-center gap-2 ${
              mode === 'random' ? 'bg-primary-500 text-white font-medium' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            <svg className='w-5 h-5' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8" cy="8" r="1"/>
              <circle cx="16" cy="8" r="1"/>
              <circle cx="12" cy="12" r="1"/>
              <circle cx="8" cy="16" r="1"/>
              <circle cx="16" cy="16" r="1"/>
            </svg>
            {t('credentials.randomAlias')}
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`flex-1 py-2 text-sm px-4 rounded flex items-center justify-center gap-2 ${
              mode === 'manual' ? 'bg-primary-500 text-white font-medium' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="7" r="4"/>
              <path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>
            </svg>
            {t('credentials.manual')}
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('credentials.service')}</h2>
          <div className="space-y-4">
            <FormInput
              id="serviceName"
              label={t('credentials.serviceName')}
              ref={serviceNameRef}
              value={watch('ServiceName') ?? ''}
              onChange={(value) => setValue('ServiceName', value)}
              required
              error={errors.ServiceName?.message}
            />
            <FormInput
              id="serviceUrl"
              label={t('credentials.serviceUrl')}
              value={watch('ServiceUrl') ?? ''}
              onChange={(value) => setValue('ServiceUrl', value)}
              error={errors.ServiceUrl?.message}
            />
          </div>
        </div>

        {(mode === 'manual' || isEditMode) && (
          <>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('credentials.loginCredentials')}</h2>
              <div className="space-y-4">
                {watch('HasPasskey') ? (
                  <>
                    {/* When passkey exists: username, passkey, email, password */}
                    <UsernameField
                      id="username"
                      label={t('common.username')}
                      value={watch('Username') ?? ''}
                      onChange={(value) => setValue('Username', value)}
                      error={errors.Username?.message}
                      onRegenerate={generateRandomUsername}
                    />
                    {!passkeyMarkedForDeletion && (
                      <div className="p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                        <div className="flex items-start gap-2">
                          <svg
                            className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                          </svg>
                          <div className="flex-1">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{t('passkeys.passkey')}</span>
                              <button
                                type="button"
                                onClick={() => setPasskeyMarkedForDeletion(true)}
                                className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                title="Delete passkey"
                              >
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <line x1="10" y1="11" x2="10" y2="17" />
                                  <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                              </button>
                            </div>
                            <div className="space-y-1 mb-2">
                              {watch('PasskeyRpId') && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('passkeys.site')}: </span>
                                  <span className="text-sm text-gray-900 dark:text-white">{watch('PasskeyRpId')}</span>
                                </div>
                              )}
                              {watch('PasskeyDisplayName') && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('passkeys.displayName')}: </span>
                                  <span className="text-sm text-gray-900 dark:text-white">{watch('PasskeyDisplayName')}</span>
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              {t('passkeys.helpText')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    {passkeyMarkedForDeletion && (
                      <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                        <div className="flex items-start gap-2">
                          <svg
                            className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                          </svg>
                          <div className="flex-1">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-sm font-medium text-red-900 dark:text-red-100">{t('passkeys.passkeyMarkedForDeletion')}</span>
                              <button
                                type="button"
                                onClick={() => setPasskeyMarkedForDeletion(false)}
                                className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                                title="Undo"
                              >
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M3 7v6h6" />
                                  <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                                </svg>
                              </button>
                            </div>
                            <p className="text-xs text-red-800 dark:text-red-200">
                              {t('passkeys.passkeyWillBeDeleted')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <EmailDomainField
                      id="email"
                      label={t('common.email')}
                      value={watch('Alias.Email') ?? ''}
                      onChange={(value: string) => setValue('Alias.Email', value)}
                      error={errors.Alias?.Email?.message}
                    />
                    <PasswordField
                      id="password"
                      label={t('common.password')}
                      value={watch('Password') ?? ''}
                      onChange={(value) => setValue('Password', value)}
                      error={errors.Password?.message}
                      showPassword={showPassword}
                      onShowPasswordChange={setShowPassword}
                    />
                  </>
                ) : (
                  <>
                    {/* When no passkey: email, username, password */}
                    <EmailDomainField
                      id="email"
                      label={t('common.email')}
                      value={watch('Alias.Email') ?? ''}
                      onChange={(value: string) => setValue('Alias.Email', value)}
                      error={errors.Alias?.Email?.message}
                    />
                    <UsernameField
                      id="username"
                      label={t('common.username')}
                      value={watch('Username') ?? ''}
                      onChange={(value) => setValue('Username', value)}
                      error={errors.Username?.message}
                      onRegenerate={generateRandomUsername}
                    />
                    <PasswordField
                      id="password"
                      label={t('common.password')}
                      value={watch('Password') ?? ''}
                      onChange={(value) => setValue('Password', value)}
                      error={errors.Password?.message}
                      showPassword={showPassword}
                      onShowPasswordChange={setShowPassword}
                    />
                  </>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('credentials.alias')}</h2>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleGenerateRandomAlias}
                  className={`w-full text-sm py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center gap-2 ${
                    hasAliasValues
                      ? 'bg-gray-500 text-white hover:bg-gray-600 focus:ring-gray-500'
                      : 'bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-500'
                  }`}
                >
                  {hasAliasValues ? (
                    <>
                      <svg className='w-5 h-5 inline-block' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                      <span>{t('credentials.clearAliasFields')}</span>
                    </>
                  ) : (
                    <>
                      <svg className='w-5 h-5 inline-block' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8" cy="8" r="1"/>
                        <circle cx="16" cy="8" r="1"/>
                        <circle cx="12" cy="12" r="1"/>
                        <circle cx="8" cy="16" r="1"/>
                        <circle cx="16" cy="16" r="1"/>
                      </svg>
                      <span>{t('credentials.generateRandomAlias')}</span>
                    </>
                  )}
                </button>
                <FormInput
                  id="firstName"
                  label={t('credentials.firstName')}
                  value={watch('Alias.FirstName') ?? ''}
                  onChange={(value) => setValue('Alias.FirstName', value)}
                  error={errors.Alias?.FirstName?.message}
                />
                <FormInput
                  id="lastName"
                  label={t('credentials.lastName')}
                  value={watch('Alias.LastName') ?? ''}
                  onChange={(value) => setValue('Alias.LastName', value)}
                  error={errors.Alias?.LastName?.message}
                />
                <FormInput
                  id="nickName"
                  label={t('credentials.nickName')}
                  value={watch('Alias.NickName') ?? ''}
                  onChange={(value) => setValue('Alias.NickName', value)}
                  error={errors.Alias?.NickName?.message}
                />
                <FormInput
                  id="gender"
                  label={t('credentials.gender')}
                  value={watch('Alias.Gender') ?? ''}
                  onChange={(value) => setValue('Alias.Gender', value)}
                  error={errors.Alias?.Gender?.message}
                />
                <FormInput
                  id="birthDate"
                  label={t('credentials.birthDate')}
                  placeholder={t('credentials.birthDatePlaceholder')}
                  value={watch('Alias.BirthDate') ?? ''}
                  onChange={(value) => setValue('Alias.BirthDate', value)}
                  error={errors.Alias?.BirthDate?.message}
                />
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('credentials.metadata')}</h2>
              <div className="space-y-4">
                <FormInput
                  id="notes"
                  label={t('credentials.notes')}
                  value={watch('Notes') ?? ''}
                  onChange={(value) => setValue('Notes', value)}
                  multiline
                  rows={4}
                  error={errors.Notes?.message}
                />
              </div>
            </div>

            <AttachmentUploader
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              originalAttachmentIds={originalAttachmentIds}
            />
          </>
        )}
      </div>
    </form>
  );
};

export default CredentialAddEdit;