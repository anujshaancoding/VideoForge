import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field } from '../components/ui/index.js';
import { useAuthStore } from '../store/authStore.js';
import { ApiError } from '../lib/api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Login + Signup screens (Wave 2). One shared form component, two thin wrappers.
//
// Brand rules: dark-first card on the app background; the submit button uses the
// standard PRIMARY-but-non-amber variant — amber `#FF7A1A` stays reserved for the
// single Export CTA (§2.3). We use "secondary" here (the dashboard's create button
// does the same) so no auth action competes with Export for the brand accent.
// ─────────────────────────────────────────────────────────────────────────────

function AuthCard({ title, subtitle, children, footer }: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-vf-bg-app p-12">
      <div className="w-full max-w-[400px] rounded-xl border border-vf-border-subtle bg-vf-surface-1 p-8 shadow-vf-4">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-vf-accent-subtle text-vf-accent-text"
          >
            ◣
          </span>
          <span className="text-md font-bold tracking-tight text-vf-text-primary">VideoForge</span>
        </div>
        <h1 className="text-xl font-bold text-vf-text-primary">{title}</h1>
        <p className="mt-1 text-sm text-vf-text-secondary">{subtitle}</p>
        <div className="mt-6">{children}</div>
        <p className="mt-6 text-center text-xs text-vf-text-tertiary">{footer}</p>
      </div>
    </main>
  );
}

type Mode = 'login' | 'signup';

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setSubmitting(true);
      try {
        if (mode === 'signup') {
          await signup(email.trim(), password, displayName.trim() || undefined);
        } else {
          await login(email.trim(), password);
        }
        // Authenticated → the router (which reads useAuthStore.user) will render the
        // Dashboard. Navigate home so a deep /login URL doesn't stick around.
        navigate('/', { replace: true });
      } catch (err) {
        setError(messageFor(err, mode));
      } finally {
        setSubmitting(false);
      }
    },
    [mode, email, password, displayName, login, signup, navigate, submitting],
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@studio.com"
      />
      {mode === 'signup' && (
        <Field
          label="Display name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Optional"
          helper="Shown on your projects. You can change it later."
        />
      )}
      <Field
        label="Password"
        type={showPassword ? 'text' : 'password'}
        name="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="inline-flex h-7 items-center rounded-sm px-2 text-xs text-vf-text-secondary hover:bg-vf-surface-3 hover:text-vf-text-primary"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        }
      />

      {error && (
        <p role="alert" className="text-sm text-vf-danger-fg">
          {error}
        </p>
      )}

      {/* Non-amber: amber is reserved for the single Export CTA + brand (§2.3). */}
      <Button type="submit" variant="secondary" size="lg" fullWidth disabled={submitting}>
        {submitting
          ? mode === 'signup'
            ? 'Creating account…'
            : 'Signing in…'
          : mode === 'signup'
            ? 'Create account'
            : 'Sign in'}
      </Button>
    </form>
  );
}

/** Map an auth error to a friendly, code-aware message. */
function messageFor(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (err.code === 'EmailTaken') return 'That email is already registered. Try signing in instead.';
    if (err.code === 'InvalidCredentials') return 'Incorrect email or password.';
    if (err.status === 400) return 'Please enter a valid email and a password of at least 8 characters.';
  }
  return mode === 'signup'
    ? 'Could not create your account. Please try again.'
    : 'Could not sign you in. Please try again.';
}

export function LoginScreen() {
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your VideoForge projects."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-vf-text-primary underline hover:no-underline">
            Create an account
          </Link>
        </>
      }
    >
      <AuthForm mode="login" />
    </AuthCard>
  );
}

export function SignupScreen() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Start cutting in your browser — what you cut is what you get."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-vf-text-primary underline hover:no-underline">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm mode="signup" />
    </AuthCard>
  );
}
