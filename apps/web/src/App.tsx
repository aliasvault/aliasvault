import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import AuthLayout from '@/layouts/AuthLayout';
import MainLayout from '@/layouts/MainLayout';
import ForgotPassword from '@/pages/auth/ForgotPassword';
import Login from '@/pages/auth/Login';
import Logout from '@/pages/auth/Logout';
import Register from '@/pages/auth/Register';
import Setup from '@/pages/auth/Setup';
import Start from '@/pages/auth/Start';
import Unlock from '@/pages/auth/Unlock';
import EmailsHome from '@/pages/emails/Home';
import Home from '@/pages/Home';
import Sync from '@/pages/sync/Sync';

/**
 * The route table. Paths are the Blazor client's, so existing links and bookmarks keep working.
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
        <Route path="/user/register" element={<Register />} />
        <Route path="/user/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route path="/user/setup" element={<Setup />} />

      {/* Vault loading gate */}
      <Route path="/sync" element={<Sync />} />

      {/* Authenticated pages */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/items" element={<ItemsHome />} />
        <Route path="/emails" element={<EmailsHome />} />
        <Route path="/welcome" element={<Navigate to="/items" replace />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
