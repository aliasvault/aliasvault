import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

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
import ItemView from '@/pages/items/View';
import NotFound from '@/pages/NotFound';
import AppsSettings from '@/pages/settings/Apps';
import GeneralSettings from '@/pages/settings/General';
import ImportExport from '@/pages/settings/importexport/ImportExport';
import ResetVault from '@/pages/settings/importexport/ResetVault';
import ChangePassword from '@/pages/settings/security/ChangePassword';
import DeleteAccount from '@/pages/settings/security/DeleteAccount';
import Disable2Fa from '@/pages/settings/security/Disable2Fa';
import Enable2Fa from '@/pages/settings/security/Enable2Fa';
import SecuritySettings from '@/pages/settings/security/Security';
import Sync from '@/pages/sync/Sync';

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
        <Route path="/items/create" element={<ItemAddEdit />} />
        <Route path="/items/:manifestId/:id/edit" element={<ItemAddEdit />} />
        <Route path="/items/:manifestId/:id" element={<ItemView />} />
        <Route path="/emails" element={<EmailsHome />} />
        <Route path="/welcome" element={<Navigate to="/items" replace />} />
        <Route path="/settings/general" element={<GeneralSettings />} />
        <Route path="/settings/security" element={<SecuritySettings />} />
        <Route path="/settings/security/change-password" element={<ChangePassword />} />
        <Route path="/settings/security/enable-2fa" element={<Enable2Fa />} />
        <Route path="/settings/security/disable-2fa" element={<Disable2Fa />} />
        <Route path="/settings/security/delete-account" element={<DeleteAccount />} />
        <Route path="/settings/import-export" element={<ImportExport />} />
        <Route path="/settings/import-export/reset-vault" element={<ResetVault />} />
        <Route path="/settings/apps" element={<AppsSettings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
