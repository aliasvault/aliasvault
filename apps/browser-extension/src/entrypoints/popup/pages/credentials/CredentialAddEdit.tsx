import { Buffer } from 'buffer';

import { yupResolver } from '@hookform/resolvers/yup';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';
import * as Yup from 'yup';

import AttachmentUploader from '@/entrypoints/popup/components/CredentialDetails/AttachmentUploader';
import EmailDomainField from '@/entrypoints/popup/components/EmailDomainField';
import { FormInput } from '@/entrypoints/popup/components/FormInput';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import Modal from '@/entrypoints/popup/components/Modal';
import PasswordField from '@/entrypoints/popup/components/PasswordField';
import UsernameField from '@/entrypoints/popup/components/UsernameField';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { IdentityHelperUtils, CreateIdentityGenerator, CreateUsernameEmailGenerator, Identity, Gender } from '@/utils/dist/shared/identity-generator';
import type { Attachment, Credential } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';

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
  const webApi = useWebApi();

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
      // On create mode, focus the service name field after a short delay to ensure the component is mounted.
      setTimeout(() => {
        serviceNameRef.current?.focus();
      }, 100);
      setIsInitialLoading(false);

      // Load persisted form values if they exist.
      loadPersistedValues().then(() => {
        // Generate default password if no persisted password exists
        if (!watch('Password')) {
          const passwordSettings = dbContext.sqliteClient!.getPasswordSettings();
          const passwordGenerator = CreatePasswordGenerator(passwordSettings);
          const defaultPassword = passwordGenerator.generateRandomPassword();
          setValue('Password', defaultPassword);
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
  }, [dbContext.sqliteClient, id, navigate, setIsInitialLoading, setValue, loadPersistedValues, watch]);

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
    // Get default identity language from database
    const identityLanguage = dbContext.sqliteClient!.getDefaultIdentityLanguage();

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

    // Generate identity with gender preference
    const identity = identityGenerator.generateRandomIdentity(genderPreference);
    const password = passwordGenerator.generateRandomPassword();

    const metadata = await dbContext.getVaultMetadata();

    const privateEmailDomains = metadata?.privateEmailDomains ?? [];
    const publicEmailDomains = metadata?.publicEmailDomains ?? [];
    const defaultEmailDomain = dbContext.sqliteClient!.getDefaultEmailDomain(privateEmailDomains, publicEmailDomains);
    const email = defaultEmailDomain ? `${identity.emailPrefix}@${defaultEmailDomain}` : identity.emailPrefix;

    setValue('Alias.Email', email);
    setValue('Alias.FirstName', identity.firstName);
    setValue('Alias.LastName', identity.lastName);
    setValue('Alias.NickName', identity.nickName);
    setValue('Alias.Gender', identity.gender);
    setValue('Alias.BirthDate', IdentityHelperUtils.normalizeBirthDateForDisplay(identity.birthDate.toISOString()));

    // In edit mode, preserve existing username and password if they exist
    if (isEditMode && watch('Username')) {
      // Keep the existing username in edit mode, so don't do anything here.
    } else {
      // Use the newly generated username
      setValue('Username', identity.nickName);
    }

    if (isEditMode && watch('Password')) {
      // Keep the existing password in edit mode, so don't do anything here.
    } else {
      // Use the newly generated password
      setValue('Password', password);
    }
  }, [isEditMode, watch, setValue, initializeGenerators, dbContext]);

  /**
   * Handle the generate random alias button press.
   */
  const handleGenerateRandomAlias = useCallback(() => {
    void generateRandomAlias();
  }, [generateRandomAlias]);

  const generateRandomUsername = useCallback(async () => {
    try {
      const usernameEmailGenerator = CreateUsernameEmailGenerator();

      let gender = Gender.Other;
      try {
        gender = watch('Alias.Gender') as Gender;
      } catch {
        // Gender parsing failed, default to other.
      }

      const identity: Identity = {
        firstName: watch('Alias.FirstName') ?? '',
        lastName: watch('Alias.LastName') ?? '',
        nickName: watch('Alias.NickName') ?? '',
        gender: gender,
        birthDate: new Date(watch('Alias.BirthDate') ?? ''),
        emailPrefix: watch('Alias.Email') ?? '',
      };

      const username = usernameEmailGenerator.generateUsername(identity);
      setValue('Username', username);
    } catch (error) {
      console.error('Error generating random username:', error);
    }
  }, [setValue, watch]);

  const initialPasswordSettings = useMemo(() => {
    return dbContext.sqliteClient?.getPasswordSettings();
  }, [dbContext.sqliteClient]);

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
      data.Alias.BirthDate = birthdate;
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
  }, [isEditMode, dbContext.sqliteClient, executeVaultMutation, navigate, mode, watch, generateRandomAlias, webApi, clearPersistedValues, originalAttachmentIds, attachments]);

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
            className={`flex-1 py-2 px-4 rounded flex items-center justify-center gap-2 ${
              mode === 'random' ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
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
            className={`flex-1 py-2 px-4 rounded flex items-center justify-center gap-2 ${
              mode === 'manual' ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
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
                {initialPasswordSettings && (
                  <PasswordField
                    id="password"
                    label={t('common.password')}
                    value={watch('Password') ?? ''}
                    onChange={(value) => setValue('Password', value)}
                    error={errors.Password?.message}
                    showPassword={showPassword}
                    onShowPasswordChange={setShowPassword}
                    initialSettings={initialPasswordSettings}
                  />
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('credentials.alias')}</h2>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleGenerateRandomAlias}
                  className="w-full bg-primary-500 text-white py-2 px-4 rounded hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 flex items-center justify-center gap-2"
                >
                  <svg className='w-5 h-5 inline-block' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8" cy="8" r="1"/>
                    <circle cx="16" cy="8" r="1"/>
                    <circle cx="12" cy="12" r="1"/>
                    <circle cx="8" cy="16" r="1"/>
                    <circle cx="16" cy="16" r="1"/>
                  </svg>
                  <span>{t('credentials.generateRandomAlias')}</span>
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