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
       * Only auto-switch modes in uncontrolled mode.
       * In controlled mode, the parent manages the mode state.
       */
      if (!isControlled) {
        // Check if it's a known domain (public, private, or hidden private)
        const isKnownDomain = publicEmailDomains.includes(domain) ||
                             privateEmailDomains.includes(domain) ||
                             hiddenPrivateEmailDomains.includes(domain);
        // Switch to domain chooser mode if domain is recognized
        setIsCustomDomain(!isKnownDomain);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, privateEmailDomains, hiddenPrivateEmailDomains, showPrivateDomains, isControlled]);

  /*
   * Re-check domain mode when private domains finish loading.
   * This handles the case where value was set before domains were loaded.
   * Only applies in uncontrolled mode - in controlled mode, parent manages the state.
   */
  useEffect(() => {
    // Skip auto-correction in controlled mode
    if (isControlled) {
      return;
    }

    if (!value || !value.includes('@')) {
      return;
    }

    const domain = value.split('@')[1];
    if (!domain) {
      return;
    }

    // Check if the domain is now recognized after private domains loaded
    const isKnownDomain = publicEmailDomains.includes(domain) ||
                         privateEmailDomains.includes(domain) ||
                         hiddenPrivateEmailDomains.includes(domain);

    // If domain is recognized and we're in custom mode, switch to domain chooser
    if (isKnownDomain && isCustomDomain) {
      setIsCustomDomain(false);
    }
  }, [publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, value, isCustomDomain, isControlled, setIsCustomDomain]);

  // Handle local part changes
  const handleLocalPartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLocalPart = e.target.value;

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
    } else if (selectedDomain) {
      onChange(`${newLocalPart}@${selectedDomain}`);
    }
  }, [isCustomDomain, selectedDomain, onChange, setIsCustomDomain]);

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
    const newIsCustom = !isCustomDomain;
    setIsCustomDomain(newIsCustom);

    if (newIsCustom) {
      /*
       * Switching to custom domain mode (free text / normal email)
       * Extract just the local part from the domain-based value
       */
      if (value && value.includes('@')) {
        const [local] = value.split('@');
        onChange(local);
        setLocalPart(local);
      }
    } else {
      // Switching to domain chooser mode
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : publicEmailDomains[0];
      setSelectedDomain(defaultDomain);

      // Only add domain if we have a local part
      if (localPart && localPart.trim()) {
        onChange(`${localPart}@${defaultDomain}`);
      } else if (value && !value.includes('@')) {
        // If we have a value without @, add the domain
        onChange(`${value}@${defaultDomain}`);
      }
    }
  }, [isCustomDomain, value, localPart, showPrivateDomains, publicEmailDomains, privateEmailDomains, onChange, setIsCustomDomain]);

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
   * Calls onGenerateAlias if provided, and switches to domain chooser mode.
   */
  const handleGenerateAliasClick = useCallback(() => {
    if (onGenerateAlias) {
      onGenerateAlias();
    }
    // Always switch to domain chooser mode
    setIsCustomDomain(false);
  }, [onGenerateAlias, setIsCustomDomain]);

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
                  ? 'text-gray-700 dark:text-gray-300'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer'
              }`}
            >
              {t('common.email')}
            </button>
            <span className="mx-1.5 text-gray-400 dark:text-gray-500">/</span>
            <button
              type="button"
              onClick={!isCustomDomain ? undefined : handleGenerateAliasClick}
              className={`text-sm font-medium transition-colors ${
                !isCustomDomain
                  ? 'text-gray-700 dark:text-gray-300'
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
              className="inline-flex items-center px-2 py-2 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-md bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-500 cursor-pointer text-sm truncate max-w-[120px]"
            >
              <span className="text-gray-500 dark:text-gray-400">@</span>
              <span className="truncate ml-0.5">{selectedDomain}</span>
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
                  <p className="text-gray-500 dark:text-gray-400 mb-3">
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