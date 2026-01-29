import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';

type EmailDomainFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  /**
   * Callback to remove this field. When provided, shows an X button in the label.
   */
  onRemove?: () => void;
  /**
   * Callback to generate an alias email. When provided, clicking "Generate alias email" will call this instead of just toggling mode.
   */
  onGenerateAlias?: () => void;
  /**
   * Controlled mode: when provided, this controls whether the field is in "email" (free text) mode.
   * When true, shows free text input; when false, shows domain chooser.
   * Use with onEmailModeChange for full controlled behavior.
   */
  isEmailMode?: boolean;
  /**
   * Callback when the email/alias mode changes. Required when using controlled mode (isEmailMode prop).
   */
  onEmailModeChange?: (isEmailMode: boolean) => void;
}

/**
 * Email domain field component with domain chooser functionality.
 * Allows users to select from private/public domains or enter custom email addresses.
 */
const EmailDomainField: React.FC<EmailDomainFieldProps> = ({
  id,
  value,
  onChange,
  error,
  required = false,
  onRemove,
  onGenerateAlias,
  isEmailMode,
  onEmailModeChange
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();

  // Support both controlled and uncontrolled modes
  const isControlled = isEmailMode !== undefined;
  const [internalIsCustomDomain, setInternalIsCustomDomain] = useState(true);

  // Use controlled value if provided, otherwise use internal state
  const isCustomDomain = isControlled ? isEmailMode : internalIsCustomDomain;

  /**
   * Update the isCustomDomain state, supporting both controlled and uncontrolled modes.
   */
  const setIsCustomDomain = useCallback((newValue: boolean | ((prev: boolean) => boolean)) => {
    const resolvedValue = typeof newValue === 'function' ? newValue(isCustomDomain) : newValue;
    if (isControlled && onEmailModeChange) {
      onEmailModeChange(resolvedValue);
    } else {
      setInternalIsCustomDomain(resolvedValue);
    }
  }, [isControlled, onEmailModeChange, isCustomDomain]);
  const [localPart, setLocalPart] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const [publicEmailDomains, setPublicEmailDomains] = useState<string[]>([]);
  const [privateEmailDomains, setPrivateEmailDomains] = useState<string[]>([]);
  const [hiddenPrivateEmailDomains, setHiddenPrivateEmailDomains] = useState<string[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);

  /**
   * Tracks whether the user explicitly toggled mode via buttons.
   * While true, the value useEffect skips auto-detection of isCustomDomain.
   */
  const modeToggledByUser = useRef(false);

  // Get email domains from vault metadata
  useEffect(() => {
    /**
     * Load email domains from vault metadata.
     */
    const loadDomains = async (): Promise<void> => {
      const metadata = await dbContext.getVaultMetadata();
      setPublicEmailDomains(metadata?.publicEmailDomains ?? []);
      setPrivateEmailDomains(metadata?.privateEmailDomains ?? []);
      setHiddenPrivateEmailDomains(metadata?.hiddenPrivateEmailDomains ?? []);
    };
    loadDomains();
  }, [dbContext]);

  // Check if private domains are available and valid
  const showPrivateDomains = useMemo(() => {
    return privateEmailDomains.length > 0 &&
           !(privateEmailDomains.length === 1 && (privateEmailDomains[0] === 'DISABLED.TLD' || privateEmailDomains[0] === ''));
  }, [privateEmailDomains]);

  // Initialize state from value prop
  useEffect(() => {
    if (!value) {
      // Value is empty - clear local part but preserve selected domain
      setLocalPart('');
      // Only set default domain if none is selected yet (initial load)
      if (!selectedDomain) {
        if (showPrivateDomains && privateEmailDomains[0]) {
          setSelectedDomain(privateEmailDomains[0]);
        } else if (publicEmailDomains[0]) {
          setSelectedDomain(publicEmailDomains[0]);
        }
      }
      return;
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      setLocalPart(local);
      setSelectedDomain(domain);

      /*
       * Auto-detect mode based on domain recognition, but only if the user
       * hasn't explicitly toggled mode via the Email/Alias buttons.
       */
      if (!modeToggledByUser.current) {
        const isKnownDomain = publicEmailDomains.includes(domain) ||
                             privateEmailDomains.includes(domain) ||
                             hiddenPrivateEmailDomains.includes(domain);

        if (isControlled && onEmailModeChange) {
          onEmailModeChange(!isKnownDomain);
        } else if (!isControlled) {
          setIsCustomDomain(!isKnownDomain);
        }
      }
    } else {
      setLocalPart(value);
      // Don't reset isCustomDomain here - preserve the current mode

      // Set default domain if not already set
      if (!selectedDomain && !value.includes('@')) {
        if (showPrivateDomains && privateEmailDomains[0]) {
          setSelectedDomain(privateEmailDomains[0]);
        } else if (publicEmailDomains[0]) {
          setSelectedDomain(publicEmailDomains[0]);
        }
      }
    }
  }, [value, publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, showPrivateDomains, isControlled, onEmailModeChange, selectedDomain, setIsCustomDomain]);

  /*
   * Re-check domain mode when domains finish loading.
   * This handles the case where value was set before domains were loaded.
   * Skip if the user has explicitly toggled mode via buttons.
   */
  useEffect(() => {
    if (modeToggledByUser.current) {
      return;
    }

    if (!value || !value.includes('@')) {
      return;
    }

    const domain = value.split('@')[1];
    if (!domain) {
      return;
    }

    const isKnownDomain = publicEmailDomains.includes(domain) ||
                         privateEmailDomains.includes(domain) ||
                         hiddenPrivateEmailDomains.includes(domain);

    if (isControlled && onEmailModeChange) {
      onEmailModeChange(!isKnownDomain);
    } else if (!isControlled) {
      if (isKnownDomain && isCustomDomain) {
        setIsCustomDomain(false);
      }
    }
  }, [publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, value, isCustomDomain, isControlled, onEmailModeChange, setIsCustomDomain]);

  /*
   * Ensure that when in alias mode (domain chooser), the value always includes the domain.
   * This handles the case when switching from email mode to alias mode, where the value
   * might be just a prefix without the domain.
   *
   * This effect runs after the toggle function, ensuring the value is updated with the domain.
   */
  useEffect(() => {
    // Only handle this in alias mode (not isCustomDomain)
    if (isCustomDomain) {
      return;
    }

    // If value exists but doesn't include @, we need to add the domain
    if (value && !value.includes('@') && value.trim()) {
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : publicEmailDomains[0];

      const domainToUse = selectedDomain || defaultDomain;

      // Only proceed if we have a domain available
      if (domainToUse) {
        // Update selectedDomain if not set
        if (!selectedDomain && defaultDomain) {
          setSelectedDomain(defaultDomain);
        }
        /*
         * Call onChange with the full email - this will update the parent's value.
         * Once the value includes @, this effect won't trigger again.
         */
        onChange(`${value}@${domainToUse}`);
      }
    }
  }, [value, isCustomDomain, selectedDomain, showPrivateDomains, privateEmailDomains, publicEmailDomains, onChange]);

  // Handle local part changes
  const handleLocalPartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLocalPart = e.target.value;
    modeToggledByUser.current = false;

    // If in custom domain mode, always pass through the full value
    if (isCustomDomain) {
      onChange(newLocalPart);
      // Stay in custom domain mode - don't auto-switch back
      return;
    }

    // Check if new value contains '@' symbol, if so, switch to custom domain mode
    if (newLocalPart.includes('@')) {
      setIsCustomDomain(true);
      onChange(newLocalPart);
      return;
    }

    setLocalPart(newLocalPart);
    // If the local part is empty, treat the whole field as empty
    if (!newLocalPart || newLocalPart.trim() === '') {
      onChange('');
    } else {
      /*
       * Always ensure we have a domain - use selectedDomain if available, otherwise use default.
       * This ensures that when user types in alias mode, we always have a domain to construct the full email.
       */
      const domainToUse = selectedDomain ||
        (showPrivateDomains && privateEmailDomains[0] ? privateEmailDomains[0] : publicEmailDomains[0] || '');
      if (domainToUse) {
        onChange(`${newLocalPart}@${domainToUse}`);
        // Update selectedDomain if it wasn't set
        if (!selectedDomain) {
          setSelectedDomain(domainToUse);
        }
      } else {
        /*
         * No domain available yet - just store the local part temporarily.
         * This should be rare, but handle it gracefully.
         */
        onChange(newLocalPart);
      }
    }
  }, [isCustomDomain, selectedDomain, onChange, setIsCustomDomain, showPrivateDomains, privateEmailDomains, publicEmailDomains]);

  // Select a domain from the popup
  const selectDomain = useCallback((domain: string) => {
    setSelectedDomain(domain);
    const cleanLocalPart = localPart.includes('@') ? localPart.split('@')[0] : localPart;
    // If the local part is empty, treat the whole field as empty
    if (!cleanLocalPart || cleanLocalPart.trim() === '') {
      onChange('');
    } else {
      onChange(`${cleanLocalPart}@${domain}`);
    }
    setIsCustomDomain(false);
    setIsPopupVisible(false);
  }, [localPart, onChange, setIsCustomDomain]);

  // Toggle between custom domain and domain chooser
  const toggleCustomDomain = useCallback(() => {
    modeToggledByUser.current = true;
    const newIsCustom = !isCustomDomain;
    setIsCustomDomain(newIsCustom);

    if (newIsCustom) {
      /*
       * Switching to custom domain mode (free text / normal email).
       * Clear the value so the user starts fresh with a regular email address.
       */
      onChange('');
      setLocalPart('');
    } else {
      // Switching to domain chooser mode - clear the old email-mode value.
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : publicEmailDomains[0];
      setSelectedDomain(defaultDomain);
      setLocalPart('');
      onChange('');
    }
  }, [isCustomDomain, showPrivateDomains, publicEmailDomains, privateEmailDomains, onChange, setIsCustomDomain]);

  // Handle clicks outside the popup
  useEffect(() => {
    /**
     * Handle clicks outside the popup to close it.
     */
    const handleClickOutside = (event: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setIsPopupVisible(false);
      }
    };

    if (isPopupVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return (): void => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isPopupVisible]);

  /**
   * Handle the "Generate alias email" button click.
   * When onGenerateAlias is provided, delegates to it (it sets the full email value).
   * Otherwise, just switches to domain chooser mode and preserves the current local part.
   */
  const handleGenerateAliasClick = useCallback(() => {
    modeToggledByUser.current = true;
    setIsCustomDomain(false);

    // Reset to the default domain so stale domains from email mode are cleared.
    const defaultDomain = showPrivateDomains && privateEmailDomains[0]
      ? privateEmailDomains[0]
      : publicEmailDomains[0];
    if (defaultDomain) {
      setSelectedDomain(defaultDomain);
    }

    // Clear the old email-mode value so it doesn't interfere with alias mode.
    setLocalPart('');
    onChange('');

    if (onGenerateAlias) {
      onGenerateAlias();
    }
  }, [onGenerateAlias, setIsCustomDomain, showPrivateDomains, privateEmailDomains, publicEmailDomains, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex items-center">
            <button
              type="button"
              onClick={isCustomDomain ? undefined : toggleCustomDomain}
              className={`text-sm font-medium transition-colors ${
                isCustomDomain
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer'
              }`}
            >
              {t('common.email')}
            </button>
            <span className="mx-2 text-gray-400 dark:text-gray-500">/</span>
            <button
              type="button"
              onClick={!isCustomDomain ? undefined : handleGenerateAliasClick}
              className={`text-sm font-medium transition-colors ${
                !isCustomDomain
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer'
              }`}
            >
              {t('common.alias')}
            </button>
            {required && <span className="text-red-500 ml-1">*</span>}
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
            title={t('common.delete')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      <div className="relative w-full">
        <div className="flex w-full">
          <input
            type="text"
            id={id}
            className={`flex-1 min-w-0 px-3 py-2 border text-sm ${
              error ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            } ${
              !isCustomDomain ? 'rounded-l-md' : 'rounded-md'
            } focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white`}
            value={isCustomDomain ? value : localPart}
            onChange={handleLocalPartChange}
          />

          {!isCustomDomain && (
            <button
              type="button"
              onClick={() => setIsPopupVisible(!isPopupVisible)}
              className={`inline-flex items-center px-2 py-2 border border-l-0 border-gray-300 dark:border-gray-600 ${onGenerateAlias ? '' : 'rounded-r-md'} bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-500 cursor-pointer text-sm truncate max-w-[120px]`}
            >
              <span className="text-gray-500 dark:text-gray-400">@</span>
              <span className="truncate ml-0.5">{selectedDomain}</span>
            </button>
          )}

          {!isCustomDomain && onGenerateAlias && (
            <button
              type="button"
              onClick={onGenerateAlias}
              className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
              title={t('common.generate')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>

        {/* Domain selection popup */}
        {isPopupVisible && !isCustomDomain && (
          <div
            ref={popupRef}
            className="absolute z-50 mt-2 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto"
          >
            <div className="p-4">
              {showPrivateDomains && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {t('items.privateEmailTitle')} <span className="text-gray-500 dark:text-gray-400">({t('items.privateEmailAliasVaultServer')})</span>
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {t('items.privateEmailDescription')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {privateEmailDomains
                      .filter((domain) => !hiddenPrivateEmailDomains.includes(domain))
                      .map((domain) => (
                        <button
                          key={domain}
                          type="button"
                          onClick={() => selectDomain(domain)}
                          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            selectedDomain === domain
                              ? 'bg-primary-600 text-white hover:bg-primary-700'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {domain}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div className={showPrivateDomains ? 'border-t border-gray-200 dark:border-gray-600 pt-4' : ''}>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {t('items.publicEmailTitle')}
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {t('items.publicEmailDescription')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {publicEmailDomains.map((domain) => (
                    <button
                      key={domain}
                      type="button"
                      onClick={() => selectDomain(domain)}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        selectedDomain === domain
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {domain}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
};

export default EmailDomainField;