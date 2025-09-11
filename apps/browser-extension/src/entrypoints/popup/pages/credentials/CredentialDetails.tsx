import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import {
  HeaderBlock,
  EmailBlock,
  TotpBlock,
  LoginCredentialsBlock,
  AliasBlock,
  NotesBlock,
  AttachmentBlock
} from '@/entrypoints/popup/components/CredentialDetails';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { Credential } from '@/utils/dist/shared/models/vault';

/**
 * Credential details page.
 */
const CredentialDetails: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const dbContext = useDb();
  const [credential, setCredential] = useState<Credential | null>(null);
  const { setIsInitialLoading } = useLoading();
  const { setHeaderButtons } = useHeaderButtons();

  /**
   * Open the credential details in a new expanded popup.
   */
  const openInNewPopup = useCallback((): void => {
    PopoutUtility.openInNewPopup(`/credentials/${id}`);
  }, [id]);

  /**
   * Navigate to the edit page for this credential.
   */
  const handleEdit = useCallback((): void => {
    navigate(`/credentials/${id}/edit`);
  }, [id, navigate]);

  useEffect(() => {
    if (PopoutUtility.isPopup()) {
      window.history.replaceState({}, '', `popup.html#/credentials`);
      window.history.pushState({}, '', `popup.html#/credentials/${id}`);
    }

    if (!dbContext?.sqliteClient || !id) {
      return;
    }

    try {
      const result = dbContext.sqliteClient.getCredentialById(id);
      if (result) {
        setCredential(result);
        setIsInitialLoading(false);
      } else {
        console.error('Credential not found');
        navigate('/credentials');
      }
    } catch (err) {
      console.error('Error loading credential:', err);
    }
  }, [dbContext.sqliteClient, id, navigate, setIsInitialLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={openInNewPopup}
            title={t('common.openInNewWindow')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={handleEdit}
          title={t('credentials.editCredential')}
          iconType={HeaderIconType.EDIT}
        />
      </div>
    );
    setHeaderButtons(headerButtonsJSX);
    return () => {};
  }, [setHeaderButtons, handleEdit, openInNewPopup, t]);

  // Clear header buttons on unmount
  useEffect((): (() => void) => {
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

  if (!credential) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <HeaderBlock credential={credential} />
      </div>
      {credential.Alias?.Email && (
        <EmailBlock
          email={credential.Alias.Email}
        />
      )}
      <TotpBlock credentialId={credential.Id} />
      <LoginCredentialsBlock credential={credential} />
      <AliasBlock credential={credential} />
      <NotesBlock notes={credential.Notes} />
      <AttachmentBlock credentialId={credential.Id} />
    </div>
  );
};

export default CredentialDetails;