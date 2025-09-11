import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';

type EmailDomainFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}

// Hardcoded public email domains (same as in AliasVault.Client)
const PUBLIC_EMAIL_DOMAINS = [
  'spamok.com',
  'solarflarecorp.com',
  'spamok.nl',
  '3060.nl',
  'landmail.nl',
  'asdasd.nl',
  'spamok.de',
  'spamok.com.ua',
  'spamok.es',
  'spamok.fr',
];

/**
 * Email domain field component with domain chooser functionality.
 * Allows users to select from private/public domains or enter custom email addresses.
 */
const EmailDomainField: React.FC<EmailDomainFieldProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  required = false
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [isCustomDomain, setIsCustomDomain] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const [privateEmailDomains, setPrivateEmailDomains] = useState<string[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);

  // Get private email domains from vault metadata
  useEffect(() => {
    /**
     * Load private email domains from vault metadata.
     */
    const loadDomains = async (): Promise<void> => {
      const metadata = await dbContext.getVaultMetadata();
      if (metadata?.privateEmailDomains) {
        setPrivateEmailDomains(metadata.privateEmailDomains);
      }
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
      // Set default domain
      if (showPrivateDomains && privateEmailDomains[0]) {
        setSelectedDomain(privateEmailDomains[0]);
      } else if (PUBLIC_EMAIL_DOMAINS[0]) {
        setSelectedDomain(PUBLIC_EMAIL_DOMAINS[0]);
      }
      return;
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      setLocalPart(local);
      setSelectedDomain(domain);

      // Check if it's a custom domain
      const isKnownDomain = PUBLIC_EMAIL_DOMAINS.includes(domain) ||
                           privateEmailDomains.includes(domain);
      setIsCustomDomain(!isKnownDomain);
    } else {
      setLocalPart(value);
      setIsCustomDomain(false);

      // Set default domain if not already set
      if (!selectedDomain && !value.includes('@')) {
        if (showPrivateDomains && privateEmailDomains[0]) {
          setSelectedDomain(privateEmailDomains[0]);
        } else if (PUBLIC_EMAIL_DOMAINS[0]) {
          setSelectedDomain(PUBLIC_EMAIL_DOMAINS[0]);
        }
      }
    }
  }, [value, privateEmailDomains, showPrivateDomains, selectedDomain]);

  // Handle local part changes
  const handleLocalPartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLocalPart = e.target.value;

    // Check if new value contains '@' symbol, if so, switch to custom domain mode
    if (newLocalPart.includes('@')) {
      setIsCustomDomain(true);
      onChange(newLocalPart);
      return;
    }

    setLocalPart(newLocalPart);
    if (!isCustomDomain && selectedDomain) {
      onChange(`${newLocalPart}@${selectedDomain}`);
    } else {
      onChange(newLocalPart);
    }
  }, [isCustomDomain, selectedDomain, onChange]);

  // Select a domain from the popup
  const selectDomain = useCallback((domain: string) => {
    setSelectedDomain(domain);
    const cleanLocalPart = localPart.includes('@') ? localPart.split('@')[0] : localPart;
    onChange(`${cleanLocalPart}@${domain}`);
    setIsCustomDomain(false);
    setIsPopupVisible(false);
  }, [localPart, onChange]);

  // Toggle between custom domain and domain chooser
  const toggleCustomDomain = useCallback(() => {
    const newIsCustom = !isCustomDomain;
    setIsCustomDomain(newIsCustom);

    if (!newIsCustom && !value.includes('@')) {
      // Switching to domain chooser mode, add default domain
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : PUBLIC_EMAIL_DOMAINS[0];
      onChange(`${localPart}@${defaultDomain}`);
      setSelectedDomain(defaultDomain);
    }
  }, [isCustomDomain, value, localPart, showPrivateDomains, privateEmailDomains, onChange]);

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

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

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
            placeholder={isCustomDomain ? t('credentials.enterFullEmail') : t('credentials.enterEmailPrefix')}
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
                    {t('credentials.privateEmailTitle')} <span className="text-gray-500 dark:text-gray-400">({t('credentials.privateEmailAliasVaultServer')})</span>
                  </h4>
                  <p className="text-gray-500 dark:text-gray-400 mb-3">
                    {t('credentials.privateEmailDescription')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {privateEmailDomains.map((domain) => (
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
                  {t('credentials.publicEmailTitle')}
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {t('credentials.publicEmailDescription')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {PUBLIC_EMAIL_DOMAINS.map((domain) => (
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

      {/* Toggle custom domain button */}
      <div>
        <button
          type="button"
          onClick={toggleCustomDomain}
          className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
        >
          {isCustomDomain
            ? t('credentials.useDomainChooser')
            : t('credentials.enterCustomDomain')}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
};

export default EmailDomainField;