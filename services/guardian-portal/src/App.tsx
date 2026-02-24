import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { SetupPage } from './pages/SetupPage';
import { ApprovalPage } from './pages/ApprovalPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/setup/:contractAddress" element={<SetupPage />} />
        <Route path="/approve/:cid" element={<ApprovalPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
