import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * The email domain lists the server published on the last sync.
 */
export type EmailDomains = {
  publicEmailDomains: string[];
  privateEmailDomains: string[];
  hiddenPrivateEmailDomains: string[];
};

export const EMPTY_EMAIL_DOMAINS: EmailDomains = { publicEmailDomains: [], privateEmailDomains: [], hiddenPrivateEmailDomains: [] };

/**
 * The mode an address starts the field in: email (free text) unless its domain is a known alias domain. Null without a domain.
 */
export const detectEmailMode = (value: string, domains: EmailDomains): boolean | null => {
  const at = value.indexOf('@');
  if (at < 0) {
    return null;
  }
  const domain = value.substring(at + 1);
  return !(domains.publicEmailDomains.includes(domain) || domains.privateEmailDomains.includes(domain) || domains.hiddenPrivateEmailDomains.includes(domain));
};

type EmailDomainFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  domains: EmailDomains;
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
  domains,
  error,
  required = false,
  onRemove,
  onGenerateAlias,
  isEmailMode,
  onEmailModeChange
}) => {
  const { t } = useTranslation();
  const { publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains } = domains;

  // Support both controlled and uncontrolled modes
  const isControlled = isEmailMode !== undefined;
  const [internalIsCustomDomain, setInternalIsCustomDomain] = useState(() => detectEmailMode(value, domains) ?? true);

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
  const popupRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Tracks whether the user explicitly toggled mode via buttons.
   * While true, the value useEffect skips auto-detection of isCustomDomain.
   */
  const modeToggledByUser = useRef(false);

  // Private domains that are available to the user to pick from
  const selectablePrivateEmailDomains = useMemo(() => {
    return privateEmailDomains.filter(domain => !hiddenPrivateEmailDomains.includes(domain));
  }, [privateEmailDomains, hiddenPrivateEmailDomains]);

  // Check if private domains are available and valid
  const showPrivateDomains = useMemo(() => {
    return selectablePrivateEmailDomains.length > 0 &&
           !(selectablePrivateEmailDomains.length === 1 && (selectablePrivateEmailDomains[0] === 'DISABLED.TLD' || selectablePrivateEmailDomains[0] === ''));
  }, [selectablePrivateEmailDomains]);

  // Initialize state from value prop
  useEffect(() => {
    if (!value) {
      // Value is empty - clear local part but preserve selected domain
      setLocalPart('');
      // Only set default domain if none is selected yet (initial load)
      if (!selectedDomain) {
        if (showPrivateDomains && selectablePrivateEmailDomains[0]) {
          setSelectedDomain(selectablePrivateEmailDomains[0]);
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
        const emailMode = !(publicEmailDomains.includes(domain) || privateEmailDomains.includes(domain) || hiddenPrivateEmailDomains.includes(domain));
        if (isControlled && onEmailModeChange) {
          onEmailModeChange(emailMode);
        } else if (!isControlled) {
          setIsCustomDomain(emailMode);
        }
      }
    } else {
      setLocalPart(value);
      // Don't reset isCustomDomain here - preserve the current mode

      // Set default domain if not already set
      if (!selectedDomain && !value.includes('@')) {
        if (showPrivateDomains && selectablePrivateEmailDomains[0]) {
          setSelectedDomain(selectablePrivateEmailDomains[0]);
        } else if (publicEmailDomains[0]) {
          setSelectedDomain(publicEmailDomains[0]);
        }
      }
    }
  }, [value, publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, selectablePrivateEmailDomains, showPrivateDomains, isControlled, onEmailModeChange, selectedDomain, setIsCustomDomain]);

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
      const defaultDomain = showPrivateDomains && selectablePrivateEmailDomains[0]
        ? selectablePrivateEmailDomains[0]
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
  }, [value, isCustomDomain, selectedDomain, showPrivateDomains, selectablePrivateEmailDomains, publicEmailDomains, onChange]);

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
        (showPrivateDomains && selectablePrivateEmailDomains[0] ? selectablePrivateEmailDomains[0] : publicEmailDomains[0] || '');
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
  }, [isCustomDomain, selectedDomain, onChange, setIsCustomDomain, showPrivateDomains, selectablePrivateEmailDomains, publicEmailDomains]);

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
      const defaultDomain = showPrivateDomains && selectablePrivateEmailDomains[0]
        ? selectablePrivateEmailDomains[0]
        : publicEmailDomains[0];
      setSelectedDomain(defaultDomain);
      setLocalPart('');
      onChange('');
    }
  }, [isCustomDomain, showPrivateDomains, publicEmailDomains, selectablePrivateEmailDomains, onChange, setIsCustomDomain]);

  // Handle clicks outside the popup
  useEffect(() => {
    /**
     * Handle clicks outside the popup to close it.
     */
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (toggleButtonRef.current && toggleButtonRef.current.contains(target)) {
        return;
      }
      if (popupRef.current && !popupRef.current.contains(target)) {
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
    const defaultDomain = showPrivateDomains && selectablePrivateEmailDomains[0]
      ? selectablePrivateEmailDomains[0]
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
  }, [onGenerateAlias, setIsCustomDomain, showPrivateDomains, selectablePrivateEmailDomains, publicEmailDomains, onChange]);

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
            <Icon name="x" className="w-4 h-4" />
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
              ref={toggleButtonRef}
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
              <Icon name="refresh" className="w-5 h-5" />
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
                    {selectablePrivateEmailDomains
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