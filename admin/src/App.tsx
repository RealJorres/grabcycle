import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { RequirePermission, RequireStaff } from './auth/RequireStaff';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { firebaseConfigError } from './lib/firebase';

// Pages load on demand so the sign-in screen and shell stay small.
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const ConfigPage = lazy(() => import('./pages/ConfigPage').then((m) => ({ default: m.ConfigPage })));
const DriverDetailPage = lazy(() => import('./pages/DriverDetailPage').then((m) => ({ default: m.DriverDetailPage })));
const DriverQueuePage = lazy(() => import('./pages/DriverQueuePage').then((m) => ({ default: m.DriverQueuePage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const RideDetailPage = lazy(() => import('./pages/RideDetailPage').then((m) => ({ default: m.RideDetailPage })));
const RidesPage = lazy(() => import('./pages/RidesPage').then((m) => ({ default: m.RidesPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })));
const SupportCasePage = lazy(() => import('./pages/SupportCasePage').then((m) => ({ default: m.SupportCasePage })));
const SupportPage = lazy(() => import('./pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const UserDetailPage = lazy(() => import('./pages/UserDetailPage').then((m) => ({ default: m.UserDetailPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const VerificationCasePage = lazy(() => import('./pages/VerificationCasePage').then((m) => ({ default: m.VerificationCasePage })));
const VerificationQueuePage = lazy(() => import('./pages/VerificationQueuePage').then((m) => ({ default: m.VerificationQueuePage })));

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireStaff>
            <Layout />
          </RequireStaff>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="verifications" element={<RequirePermission permission="review.read"><VerificationQueuePage /></RequirePermission>} />
        <Route path="verifications/:caseId" element={<RequirePermission permission="review.read"><VerificationCasePage /></RequirePermission>} />
        <Route path="drivers" element={<RequirePermission permission="review.read"><DriverQueuePage /></RequirePermission>} />
        <Route path="drivers/:uid" element={<RequirePermission permission="users.read"><DriverDetailPage /></RequirePermission>} />
        <Route path="users" element={<RequirePermission permission="users.read"><UsersPage /></RequirePermission>} />
        <Route path="users/:uid" element={<RequirePermission permission="users.read"><UserDetailPage /></RequirePermission>} />
        <Route path="rides" element={<RequirePermission permission="rides.read"><RidesPage /></RequirePermission>} />
        <Route path="rides/:rideId" element={<RequirePermission permission="rides.read"><RideDetailPage /></RequirePermission>} />
        <Route path="support" element={<RequirePermission permission="support.manage"><SupportPage /></RequirePermission>} />
        <Route path="support/:caseId" element={<RequirePermission permission="support.manage"><SupportCasePage /></RequirePermission>} />
        <Route path="config" element={<RequirePermission permission="config.manage"><ConfigPage /></RequirePermission>} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="staff" element={<RequirePermission permission="staff.manage"><StaffPage /></RequirePermission>} />
        <Route path="*" element={<p className="text-sm text-muted">Page not found.</p>} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export function App() {
  const missing = firebaseConfigError();
  if (missing) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="max-w-lg rounded-2xl bg-surface p-8 shadow-sm ring-1 ring-line">
          <h1 className="text-xl font-semibold">Dashboard not configured</h1>
          <p className="mt-2 text-sm text-muted">This build has no Firebase web configuration. Set these variables (see admin/.env.example) and rebuild:</p>
          <ul className="mt-3 list-disc pl-5 font-mono text-xs">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
