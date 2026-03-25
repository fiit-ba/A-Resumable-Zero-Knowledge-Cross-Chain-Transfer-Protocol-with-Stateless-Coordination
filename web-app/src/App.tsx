import { Routes, Route, Navigate } from 'react-router-dom';
import { TransferForm } from './pages/TransferForm';
import { ProgressPage } from './pages/ProgressPage';
import './App.css';

export default function App() {
  return (
    <div className="min-h-screen flow-root bg-gray-50 dark:bg-gray-950">
      <Routes>
        <Route path="/" element={<TransferForm />} />
        <Route path="/progress/:jobId" element={<ProgressPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
