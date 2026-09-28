import { sanitizeEmailHtml } from '@aliasvault/client/email/EmailHtmlSanitizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type EmailViewModel, getSourceText, hasSource } from '@/utils/EmailViewModel';

/** The formats an email can be shown in. */
export type EmailViewMode = 'html' | 'plain' | 'source';

/**
 * HTML-escape text for a pre block.
 */
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The formats available for an email: html and plain when the source had those parts, source whenever there is one.
 */
export const getAvailableModes = (email: EmailViewModel | null): EmailViewMode[] => {
  const modes: EmailViewMode[] = [];
  if (email && email.htmlBody !== null && email.htmlBody.trim().length > 0) {
    modes.push('html');
  }
  if (email && email.textBody !== null) {
    modes.push('plain');
  }
  if (email && hasSource(email)) {
    modes.push('source');
  }
  return modes;
};

/**
 * The rendered body of an email in the chosen format, cycling through the available formats.
 * @param email - the email, null while it loads
 * @param onBodyLoading - called with true before a heavy sanitize pass and false after, for a skeleton
 */
export function useEmailBody(email: EmailViewModel | null, onBodyLoading?: (loading: boolean) => void): { emailBody: string; viewMode: EmailViewMode; availableModes: EmailViewMode[]; formatLabel: string; cycleViewMode: () => void } {
  const { t } = useTranslation();
  const [emailBody, setEmailBody] = useState('');
  const [viewMode, setViewMode] = useState<EmailViewMode>('html');
  const renderedEmailId = useRef<number | null>(null);
  const sequence = useRef(0);
  const noBody = t('components.main.email.emailModal.NoEmailBody');

  /**
   * Render the body in a format.
   */
  const applyViewMode = useCallback(async (target: EmailViewModel, mode: EmailViewMode): Promise<string> => {
    switch (mode) {
      case 'html':
        return target.htmlBody !== null && target.htmlBody.trim().length > 0 ? sanitizeEmailHtml(target.htmlBody) : noBody;
      case 'plain':
        return target.textBody !== null ? `<pre style='font-family: system-ui, -apple-system, sans-serif; white-space: pre-wrap; word-wrap: break-word; margin: 0;'>${escapeHtml(target.textBody)}</pre>` : noBody;
      case 'source': {
        const source = await getSourceText(target);
        return source.trim().length > 0 ? `<pre style='font-family: monospace; white-space: pre-wrap; word-wrap: break-word; margin: 0; font-size: 12px; line-height: 1.4;'>${escapeHtml(source)}</pre>` : noBody;
      }
      default:
        return noBody;
    }
  }, [noBody]);

  /*
   * Only (re)compute the body when the email actually changes.
   */
  useEffect(() => {
    if (email?.id === renderedEmailId.current && email !== null) {
      return;
    }
    renderedEmailId.current = email?.id ?? null;
    setEmailBody('');
    if (!email) {
      return;
    }

    const current = ++sequence.current;
    onBodyLoading?.(true);
    setTimeout(async () => {
      if (current !== sequence.current) {
        return;
      }
      const modes = getAvailableModes(email);
      const mode = modes[0] ?? 'html';
      const body = modes.length > 0 ? await applyViewMode(email, mode) : noBody;
      if (current !== sequence.current) {
        return;
      }
      setViewMode(mode);
      setEmailBody(body);
      onBodyLoading?.(false);
    }, 1);
  }, [applyViewMode, email, noBody, onBodyLoading]);

  const availableModes = getAvailableModes(email);

  /**
   * Switch to the next available format.
   */
  const cycleViewMode = useCallback((): void => {
    if (!email || availableModes.length <= 1) {
      return;
    }
    const next = availableModes[(availableModes.indexOf(viewMode) + 1) % availableModes.length];
    void applyViewMode(email, next).then((body) => {
      setViewMode(next);
      setEmailBody(body);
    });
  }, [applyViewMode, availableModes, email, viewMode]);

  const formatLabel = viewMode === 'html' ? t('sharedResources.EmailFormatHtml') : viewMode === 'plain' ? t('sharedResources.EmailFormatPlain') : t('sharedResources.EmailFormatSource');

  return { emailBody, viewMode, availableModes, formatLabel, cycleViewMode };
}
