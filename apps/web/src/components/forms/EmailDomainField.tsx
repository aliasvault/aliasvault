import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAppConfig } from '@/config/AppConfig';
import { useDb } from '@/context/DbContext';

type EmailDomainFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  onRemove?: () => void;
  /** Start in free text email mode instead of alias mode. */
  defaultToEmailMode?: boolean;
  onGenerateAlias?: () => void;
};

/**
 * Email input that switches between a free text email and an alias email (which shows a domain picker element).
 */
const EmailDomainField: React.FC<EmailDomainFieldProps> = ({ id, value, onChange, error = null, required = false, onRemove, defaultToEmailMode = false, onGenerateAlias }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [privateDomains, setPrivateDomains] = useState<string[]>([]);
  const [publicDomains, setPublicDomains] = useState<string[]>([]);
  const [hiddenPrivateDomains, setHiddenPrivateDomains] = useState<string[]>([]);
  const [isCustomDomain, setIsCustomDomain] = useState(defaultToEmailMode);
  const [localPart, setLocalPart] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const modeToggledByUser = useRef(false);
  const tk = 'components.main.forms.emailDomainField';

  const showPrivateDomains = privateDomains.length > 0 && !(privateDomains.length === 1 && (privateDomains[0] === 'DISABLED.TLD' || privateDomains[0] === ''));
  const defaultDomain = showPrivateDomains ? privateDomains[0] : publicDomains[0] ?? '';

  useEffect(() => {
    let cancelled = false;
    void dbContext.getVaultMetadata().then((metadata) => {
      if (cancelled) {
        return;
      }
      const hidden = metadata?.hiddenPrivateEmailDomains ?? getAppConfig().hiddenPrivateEmailDomains;
      setHiddenPrivateDomains(hidden);
      setPrivateDomains((metadata?.privateEmailDomains ?? getAppConfig().privateEmailDomains).filter(d => !hidden.includes(d)));
      setPublicDomains(metadata?.publicEmailDomains ?? []);
    });
    return (): void => {
      cancelled = true;
    };
  }, [dbContext]);

  /*
   * Derive the local part, domain and mode from the value. After a toggle the user's mode choice is kept; on load
   * the mode is detected from the domain. A value without a domain in alias mode gets the domain appended.
   */
  useEffect(() => {
    const skipAutoDetect = modeToggledByUser.current;
    if (value.length === 0) {
      setLocalPart('');
      setSelectedDomain(d => d.length > 0 ? d : defaultDomain);
      return;
    }

    const at = value.indexOf('@');
    if (at >= 0) {
      const local = value.substring(0, at);
      const domain = value.substring(at + 1);
      setLocalPart(local);
      setSelectedDomain(domain);
      if (!skipAutoDetect) {
        setIsCustomDomain(!(publicDomains.includes(domain) || privateDomains.includes(domain) || hiddenPrivateDomains.includes(domain)));
      }
      return;
    }

    setLocalPart(value);
    if (!skipAutoDetect) {
      setIsCustomDomain(true);
    }
    const domain = selectedDomain.length > 0 ? selectedDomain : defaultDomain;
    if (selectedDomain.length === 0) {
      setSelectedDomain(defaultDomain);
    }
    if (!isCustomDomain && skipAutoDetect && value.trim().length > 0 && domain.length > 0) {
      onChange(`${value}@${domain}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, publicDomains, privateDomains, hiddenPrivateDomains, defaultDomain]);

  /**
   * The user typed in the input.
   */
  const onInput = (input: string): void => {
    if (isCustomDomain) {
      onChange(input);
      return;
    }
    if (input.includes('@')) {
      setIsCustomDomain(true);
      onChange(input);
      return;
    }
    setLocalPart(input);
    if (input.trim().length === 0) {
      onChange('');
      return;
    }
    const domain = selectedDomain.length > 0 ? selectedDomain : defaultDomain;
    if (domain.length > 0) {
      if (selectedDomain.length === 0) {
        setSelectedDomain(domain);
      }
      onChange(`${input}@${domain}`);
    } else {
      onChange(input);
    }
  };

  /**
   * Pick a domain from the popup.
   */
  const selectDomain = (domain: string): void => {
    setSelectedDomain(domain);
    const cleanLocalPart = localPart.includes('@') ? localPart.split('@')[0] : localPart;
    onChange(cleanLocalPart.trim().length === 0 ? '' : `${cleanLocalPart}@${domain}`);
    setIsCustomDomain(false);
    setIsPopupVisible(false);
  };

  /**
   * Switch to free text email mode, starting fresh.
   */
  const toggleToEmailMode = (): void => {
    if (isCustomDomain) {
      return;
    }
    modeToggledByUser.current = true;
    setIsCustomDomain(true);
    setLocalPart('');
    onChange('');
  };

  /**
   * Switch to alias mode and generate an alias.
   */
  const toggleToAliasMode = (): void => {
    if (!isCustomDomain) {
      return;
    }
    modeToggledByUser.current = true;
    setIsCustomDomain(false);
    setSelectedDomain(defaultDomain);
    setLocalPart('');
    onChange('');
    onGenerateAlias?.();
  };

  /**
   * Generate a new alias in place.
   */
  const handleRegenerate = (): void => {
    modeToggledByUser.current = true;
    onGenerateAlias?.();
  };

  /**
   * Classes of a domain chip in the popup.
   */
  const domainButtonClasses = (domain: string): string => `px-3 py-1.5 text-sm rounded-md transition-colors ${selectedDomain === domain ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600'}`;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="flex items-center">
              <button type="button" disabled={isCustomDomain} className={isCustomDomain ? 'text-sm font-medium text-primary-600 dark:text-primary-400' : 'text-sm font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer transition-colors'} onClick={toggleToEmailMode}>
                {t('sharedResources.Email')}
              </button>
              <span className="mx-2 text-gray-400 dark:text-gray-500">/</span>
              <button type="button" disabled={!isCustomDomain} className={!isCustomDomain ? 'text-sm font-medium text-primary-600 dark:text-primary-400' : 'text-sm font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer transition-colors'} onClick={toggleToAliasMode}>
                {t(`${tk}.Alias`)}
              </button>
              {required && <span className="text-red-500 ml-1">*</span>}
            </div>
          </div>
          {onRemove && (
            <button type="button" onClick={onRemove} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title={t('sharedResources.Delete')}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="relative w-full overflow-visible">
          <div className="flex w-full">
            <input type="text" id={id} className={`outline-0 shadow-sm bg-gray-50 text-gray-900 flex-1 min-w-0 px-3 py-2 border text-sm ${error !== null ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} ${isCustomDomain ? 'rounded-md' : 'rounded-l-md'} focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white`} value={isCustomDomain ? value : localPart} onChange={e => onInput(e.target.value)} />
            {!isCustomDomain && (
              <button type="button" onClick={() => setIsPopupVisible(v => !v)} className={`inline-flex items-center px-2 py-2 border border-l-0 border-gray-300 dark:border-gray-600 ${onGenerateAlias ? '' : 'rounded-r-md'} bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-500 cursor-pointer text-sm truncate max-w-[120px]`}>
                <span className="text-gray-500 dark:text-gray-400">@</span>
                <span className="truncate ml-0.5">{selectedDomain}</span>
              </button>
            )}
            {!isCustomDomain && onGenerateAlias && (
              <button type="button" onClick={handleRegenerate} className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" title={t('sharedResources.Generate')}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>

          {isPopupVisible && !isCustomDomain && (
            <div className="absolute z-50 mt-2 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
              <div className="p-4">
                {showPrivateDomains && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {t(`${tk}.PrivateEmailTitle`)} <span className="text-gray-500 dark:text-gray-400">({t(`${tk}.PrivateEmailAliasVaultServer`)})</span>
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t(`${tk}.PrivateEmailDescription`)}</p>
                    <div className="flex flex-wrap gap-2">
                      {privateDomains.map(domain => <button key={domain} type="button" onClick={() => selectDomain(domain)} className={domainButtonClasses(domain)}>{domain}</button>)}
                    </div>
                  </div>
                )}

                <div className={showPrivateDomains ? 'border-t border-gray-200 dark:border-gray-600 pt-4' : ''}>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t(`${tk}.PublicEmailTitle`)}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t(`${tk}.PublicEmailDescription`)}</p>
                  <div className="flex flex-wrap gap-2">
                    {publicDomains.map(domain => <button key={domain} type="button" onClick={() => selectDomain(domain)} className={domainButtonClasses(domain)}>{domain}</button>)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {error !== null && <p className="text-sm text-red-500 mt-1">{error}</p>}
      </div>

      {isPopupVisible && !isCustomDomain && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-40" onClick={() => setIsPopupVisible(false)} style={{ top: 0, left: 0, right: 0, bottom: 0 }}></div>
      )}
    </>
  );
};

export default EmailDomainField;
