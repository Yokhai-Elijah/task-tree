import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Supabase sends sign-up failures back in the URL (e.g. when the email isn't on
// the access list and our database trigger refuses the account).
function errorFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const description = params.get('error_description');
  if (!description) return null;
  window.history.replaceState(null, '', window.location.pathname);
  if (/database error/i.test(description)) {
    return "That account isn't on the team's access list. Ask an admin to add your email.";
  }
  return description;
}

export default function Login() {
  const [error, setError] = useState(errorFromUrl);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function google() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  async function magicLink(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      setError(/database error/i.test(error.message) ? "That email isn't on the access list." : error.message);
    } else setSent(true);
  }

  return (
    <div className="center-screen">
      <div className="card login">
        <div className="logo">
          ▲ TASK <span>TREE</span>
        </div>
        <p className="muted">Sign in with the account your team lead added to the access list.</p>

        <button className="primary wide" onClick={google}>
          Continue with Google
        </button>

        <div className="or">or</div>

        {sent ? (
          <p className="notice">Check {email} for a sign-in link.</p>
        ) : (
          <form onSubmit={magicLink} className="stack">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <button type="submit" className="wide" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
