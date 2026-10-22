import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { Button, ErrorBanner, Notice, TextField } from '../components/ui';
import { requireFirebase } from '../lib/firebase';
import { signInMessage } from '../lib/authMessages';
import { useAuth } from './authContext';

export function LoginPage() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(requireFirebase().auth, email.trim(), password);
    } catch (err) {
      setError(signInMessage((err as { code?: string }).code ?? ''));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setError(null);
    // Same confirmation either way so the form cannot be used to probe accounts.
    await sendPasswordResetEmail(requireFirebase().auth, email.trim()).catch(() => undefined);
    setResetSent(true);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-surface p-8 shadow-sm ring-1 ring-line"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-xl font-semibold">GrabCycle Operations</h1>
            <p className="text-sm text-muted">Authorized staff only</p>
          </div>
        </div>
        <TextField label="Work email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBanner message={error} />
        {resetSent && <Notice tone="success">If that address belongs to a staff account, a reset link is on its way.</Notice>}
        <Button type="submit" busy={busy}>
          Sign in
        </Button>
        <Button variant="ghost" onClick={() => void reset()}>
          Forgot password?
        </Button>
        <p className="text-xs text-muted">Access is logged. Sessions end when you close this tab.</p>
      </form>
    </div>
  );
}
