import { type FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * A password gets Karim in with no round trip. The emailed code is the way
 * back when a password is forgotten, and it is deliberately second: this
 * project sends on Supabase's shared mail server, which allows two messages an
 * hour, so a mistyped address would otherwise lock the day.
 */
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"password" | "code" | "codeSent">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      if (mode === "password") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) setError(err.message);
      } else if (mode === "code") {
        const { error: err } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: false },
        });
        if (err) setError(err.message);
        else {
          setMode("codeSent");
          setSaid("Check the inbox for a code. It is good for an hour.");
        }
      } else {
        const { error: err } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "email",
        });
        if (err) setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Editor desk</h1>
          <p className="muted mt-1 text-sm">Everything around the edit. The cut is yours.</p>
        </div>

        <form onSubmit={go} className="panel space-y-4 p-5">
          <label className="block">
            <span className="muted mb-1.5 block text-xs uppercase tracking-wide">Email</span>
            <input
              id="signin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="raised w-full rounded-md border hairline px-3 py-2 text-sm"
              placeholder="you@maharamedia.com"
            />
          </label>

          {mode === "password" && (
            <label className="block">
              <span className="muted mb-1.5 block text-xs uppercase tracking-wide">Password</span>
              <input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="raised w-full rounded-md border hairline px-3 py-2 text-sm"
              />
            </label>
          )}

          {mode === "codeSent" && (
            <label className="block">
              <span className="muted mb-1.5 block text-xs uppercase tracking-wide">
                Code from the email
              </span>
              <input
                id="signin-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="raised w-full rounded-md border hairline px-3 py-2 font-mono text-sm tracking-widest"
              />
            </label>
          )}

          {error && (
            <p className="rounded-md border border-[color:var(--color-blocked)]/40 bg-[color:var(--color-blocked)]/10 px-3 py-2 text-sm text-[color:var(--color-blocked)]">
              {error}
            </p>
          )}
          {said && <p className="muted text-sm">{said}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-sm font-medium text-[color:var(--color-ink-950)] disabled:opacity-50"
          >
            {busy
              ? "One moment"
              : mode === "password"
                ? "Sign in"
                : mode === "code"
                  ? "Email me a code"
                  : "Enter"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "code" : "password");
              setError(null);
              setSaid(null);
            }}
            className="muted w-full text-center text-xs underline underline-offset-4"
          >
            {mode === "password" ? "Use an emailed code instead" : "Use a password instead"}
          </button>
        </form>

        <p className="muted mt-6 text-center text-xs">
          Only addresses on the editor list can open this.
        </p>
      </div>
    </div>
  );
}
