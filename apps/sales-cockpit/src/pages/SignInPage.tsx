import { type FormEvent, useState } from "react";
import { Wordmark } from "../components/Wordmark";
import { portalUrl } from "../lib/portal";
import { supabase } from "../lib/supabase";

/**
 * The same front door as the other cockpits: the wordmark, one card, one
 * heading, on the plain canvas.
 *
 * Almost nobody should reach this. The portal signs people in and sends them
 * straight here, so this is the way in on a day the portal is down. A
 * password gets in with no round trip; the emailed code is the way back when
 * one is forgotten, and it is deliberately second, because this project sends
 * on Supabase's shared mail server, which allows two messages an hour.
 */
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"password" | "code" | "codeSent">(
    "password",
  );
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

  const field =
    "h-11 w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 text-sm placeholder:text-[color:var(--muted-foreground)]";

  return (
    <div className="pt-safe pb-safe flex min-h-full flex-col">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <div className="mb-6 flex justify-center">
              <Wordmark size="lg" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sign in to Mahara
            </h1>
            <p className="muted text-sm">
              One sign-in for every cockpit. This is the sales cockpit; normally
              the portal opens it for you.
            </p>
          </div>

          <form onSubmit={go} className="panel space-y-4 p-6">
            <div className="space-y-2">
              <label
                htmlFor="signin-email"
                className="block text-sm font-medium"
              >
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={field}
                placeholder="you@maharamedia.com"
              />
            </div>

            {mode === "password" && (
              <div className="space-y-2">
                <label
                  htmlFor="signin-password"
                  className="block text-sm font-medium"
                >
                  Password
                </label>
                <input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={field}
                  placeholder="••••••••"
                />
              </div>
            )}

            {mode === "codeSent" && (
              <div className="space-y-2">
                <label
                  htmlFor="signin-code"
                  className="block text-sm font-medium"
                >
                  Code from the email
                </label>
                <input
                  id="signin-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className={`${field} font-mono tracking-widest`}
                />
              </div>
            )}

            {error && (
              <p className="rounded-[var(--radius-md)] bg-[color:var(--destructive)]/10 px-3 py-2 text-center text-sm text-[color:var(--destructive)]">
                {error}
              </p>
            )}
            {said && <p className="muted text-sm">{said}</p>}

            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-[var(--radius-md)] bg-[color:var(--primary)] text-sm font-medium text-[color:var(--primary-foreground)] disabled:opacity-50"
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
              {mode === "password"
                ? "Use an emailed code instead"
                : "Use a password instead"}
            </button>
          </form>

          <p className="muted text-center text-sm">
            Signing in somewhere else?{" "}
            <a
              className="font-medium text-[color:var(--primary)] underline underline-offset-4"
              href={portalUrl()}
            >
              Open the portal
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
