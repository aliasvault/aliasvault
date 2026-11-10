import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import type { AutofillConfirmAnswer, AutofillConfirmation } from '@/utils/types/messaging/AutofillConfirmation';

const BOLD_MARK = '\u0000';

/** How long the fill buttons stay disabled, so a click aimed at the page cannot land by accident as the window opens. */
const FILL_DELAY_MS = 1000;

/**
 * Put `value` in bold where the translated `text` has BOLD_MARK, so translations carry no markup.
 */
function withBoldValue(text: string, value: string): React.ReactNode {
  return text.split(BOLD_MARK).map((part, index) => (
    <React.Fragment key={index}>
      {index > 0 && <strong>{value}</strong>}
      {part}
    </React.Fragment>
  ));
}

/**
 * The host of a saved URL, or '' when it does not parse; a URL saved without a scheme is read as https.
 */
function toHost(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

/**
 * Asks whether to fill an item into a page, in a window the page cannot cover or click through. For an item of another website it
 * also offers to add the page URL to the item, like the mobile autofill does.
 */
const AutofillConfirm: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { setIsInitialLoading } = useLoading();
  const [confirmation, setConfirmation] = useState<AutofillConfirmation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [canFill, setCanFill] = useState(false);
  const requestId = new URLSearchParams(location.search).get('requestId') ?? '';

  useEffect(() => {
    sendMessage('GET_AUTOFILL_CONFIRMATION', { requestId })
      .then(setConfirmation)
      .catch(() => setConfirmation(null))
      .finally(() => {
        setLoaded(true);
        setIsInitialLoading(false);
      });
  }, [requestId, setIsInitialLoading]);

  useEffect(() => {
    const timer = setTimeout(() => setCanFill(true), FILL_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, []);

  /**
   * Send the answer to the background, which fills or not and closes this window.
   */
  const answer = (value: AutofillConfirmAnswer): void => {
    sendMessage('RESOLVE_AUTOFILL_CONFIRMATION', { requestId, answer: value })
      .then((response) => {
        if (!response.success) {
          // The request is gone (answered elsewhere, or the background restarted): nothing left to decide.
          window.close();
        }
      })
      .catch(() => window.close());
  };

  if (!loaded) {
    return null;
  }

  if (!confirmation) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">{t('common.errors.unknownErrorTryAgain')}</p>
        <Button variant="secondary" onClick={() => window.close()}>{t('common.close')}</Button>
      </div>
    );
  }

  const mismatch = !confirmation.matchesPage;
  const savedForHosts = [...new Set(confirmation.itemUrls.map(toHost).filter((host) => host !== ''))];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{t('content.autofillConfirm.title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
          {mismatch ? (
            withBoldValue(t('content.autofillConfirm.siteMismatch', { host: BOLD_MARK }), confirmation.pageHost)
          ) : (
            <>{withBoldValue(t('content.autofillConfirm.fillOn', { host: BOLD_MARK }), confirmation.pageHost)} {t('content.autofillConfirm.description')}</>
          )}
        </p>
      </div>

      <div>
        <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            {confirmation.logoSrc && <img src={confirmation.logoSrc} alt="" className="w-8 h-8 flex-shrink-0 rounded-[17%]" />}
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-white text-sm truncate">{confirmation.itemName}</div>
              {confirmation.itemDetails && <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{confirmation.itemDetails}</div>}
            </div>
          </div>
          {savedForHosts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 truncate">
              {withBoldValue(t('content.autofillConfirm.savedFor', { websites: BOLD_MARK }), savedForHosts.join(', '))}
            </div>
          )}
        </div>

        <div className="flex justify-center py-2">
          <Icon name="arrow-narrow-down" className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </div>

        <div className={`p-3 rounded-lg border flex items-center gap-3 ${mismatch ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800'}`}>
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
            <Icon name="globe-alt" className={`w-6 h-6 ${mismatch ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`} />
          </div>
          <div className="font-medium text-gray-900 dark:text-white text-sm break-all">{confirmation.pageHost}</div>
        </div>
      </div>

      <div className="space-y-3">
        {mismatch ? (
          <>
            <Button onClick={() => answer('link')} disabled={!canFill}>{t('native.linkUrlPromptLinkAction')}</Button>
            <Button variant="secondary" onClick={() => answer('fill')} disabled={!canFill}>{t('native.linkUrlPromptSkipAction')}</Button>
          </>
        ) : (
          <Button onClick={() => answer('fill')} disabled={!canFill}>{t('common.continue')}</Button>
        )}
        <Button variant="secondary" onClick={() => answer('cancel')}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
};

export default AutofillConfirm;
