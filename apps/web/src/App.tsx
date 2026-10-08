import { CapabilityKeys } from '@aliasvault/models/webapi';
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { RequireCapability } from '@/context/CapabilityContext';
import AuthLayout from '@/layouts/AuthLayout';
import MainLayout from '@/layouts/MainLayout';
import ForgotPassword from '@/pages/auth/ForgotPassword';
import Login from '@/pages/auth/Login';
import Logout from '@/pages/auth/Logout';
import Setup from '@/pages/auth/Setup';
import Start from '@/pages/auth/Start';
import Unlock from '@/pages/auth/Unlock';
import EmailsHome from '@/pages/emails/Home';
import Home from '@/pages/Home';
import ItemAddEdit from '@/pages/items/AddEdit';
import ItemsHome from '@/pages/items/Home';
import RecentlyDeleted from '@/pages/items/RecentlyDeleted';
import ItemView from '@/pages/items/View';
import NotFound from '@/pages/NotFound';
import AppsSettings from '@/pages/settings/Apps';
import FamilySharing from '@/pages/settings/FamilySharing';
import GeneralSettings from '@/pages/settings/General';
import IdentityGeneratorSettings from '@/pages/settings/IdentityGenerator';
import ImportExport from '@/pages/settings/importexport/ImportExport';
import ResetVault from '@/pages/settings/importexport/ResetVault';
import PasswordGeneratorSettings from '@/pages/settings/PasswordGenerator';
import ChangePassword from '@/pages/settings/security/ChangePassword';
import Clipboard from '@/pages/settings/security/Clipboard';
import DeleteAccount from '@/pages/settings/security/DeleteAccount';
import SessionsAndLogs from '@/pages/settings/security/SessionsAndLogs';
import TwoFactor from '@/pages/settings/security/TwoFactor';
import VaultUnlock from '@/pages/settings/security/VaultUnlock';
import SettingsOverview from '@/pages/settings/Settings';
import StorageInsights from '@/pages/settings/StorageInsights';
import Sync from '@/pages/sync/Sync';
import Welcome from '@/pages/Welcome';

/**
 * The route table.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      {/* Unauthenticated pages */}
      <Route path="/user/start" element={<Start />} />
      <Route path="/user/logout" element={<Logout />} />
      <Route element={<AuthLayout />}>
        <Route path="/user/login" element={<Login />} />
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/unlock/:skipWebAuthn" element={<Unlock />} />
        <Route path="/user/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route path="/user/setup" element={<Setup />} />

      {/* Vault loading gate */}
      <Route path="/sync" element={<Sync />} />

      {/* Authenticated pages */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/items" element={<ItemsHome />} />
        <Route path="/items/folder/:manifestId/:folderId" element={<ItemsHome />} />
        <Route path="/items/recently-deleted" element={<RecentlyDeleted />} />
        <Route path="/items/create" element={<ItemAddEdit />} />
        <Route path="/items/:manifestId/:id/edit" element={<ItemAddEdit />} />
        <Route path="/items/:manifestId/:id" element={<ItemView />} />
        <Route path="/emails" element={<EmailsHome />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/settings" element={<SettingsOverview />} />
        <Route path="/settings/general" element={<GeneralSettings />} />
        <Route path="/settings/password-generator" element={<PasswordGeneratorSettings />} />
        <Route path="/settings/identity-generator" element={<IdentityGeneratorSettings />} />
        <Route path="/settings/security" element={<Navigate to="/settings" replace />} />
        <Route path="/settings/security/change-password" element={<ChangePassword />} />
        <Route path="/settings/security/vault-unlock" element={<VaultUnlock />} />
        <Route path="/settings/security/clipboard" element={<Clipboard />} />
        <Route path="/settings/security/delete-account" element={<DeleteAccount />} />
        <Route path="/settings/sessions" element={<SessionsAndLogs />} />
        <Route path="/settings/two-factor" element={<TwoFactor key="status" />} />
        <Route path="/settings/two-factor/enable" element={<TwoFactor key="enable" mode="enable" />} />
        <Route path="/settings/two-factor/disable" element={<TwoFactor key="disable" mode="disable" />} />
        <Route path="/settings/storage-insights" element={<StorageInsights />} />
        <Route path="/settings/family-sharing" element={<RequireCapability capability={CapabilityKeys.VaultSharing}><FamilySharing /></RequireCapability>} />
        <Route path="/settings/import-export" element={<ImportExport />} />
        <Route path="/settings/import-export/reset-vault" element={<ResetVault />} />
        <Route path="/settings/apps" element={<AppsSettings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
