import { type FormEvent, useState } from "react";
import { FIELD } from "../components/bits";
import { Wordmark } from "../components/Wordmark";
import { portalUrl } from "../lib/portal";
import { supabase } from "../lib/supabase";

/**
 * The same front door as the other three cockpits: the wordmark, the teal
 * glow behind it, one card, one heading.
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

  const field = `${FIELD} h-11`;

  // One wordmark, above the card: the page used to carry a second one in a
  // bar across the top.
  return (
    <div className="relative flex min-h-full flex-col pt-safe pb-safe">
      <div className="relative flex flex-1 items-center justify-center p-4">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-0 left-1/4 size-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-1/4 bottom-0 size-96 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <div className="mb-6 flex justify-center">
              <Wordmark size="lg" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sign in to Mahara
            </h1>
            <p className="text-sm text-muted-foreground">
              One sign-in for every cockpit. This is the editor desk; normally
              the portal opens it for you.
            </p>
          </div>

          <form
            onSubmit={go}
            className="glow-teal space-y-4 rounded-2xl border bg-card p-6"
          >
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
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {said && (
              <p role="status" className="text-sm text-muted-foreground">
                {said}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "One moment"
                : mode === "password"
                  ? "Sign in"
                  : mode === "code"
                    ? "Email me a code"
                    : "Verify code"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "password" ? "code" : "password");
                setError(null);
                setSaid(null);
              }}
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {mode === "password"
                ? "Use an emailed code instead"
                : "Use a password instead"}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Signing in somewhere else?{" "}
            <a
              className="font-medium text-primary underline-offset-4 hover:underline"
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
