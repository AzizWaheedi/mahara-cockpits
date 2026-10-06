import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { getCockpitSupabaseClient, useCockpitAuth } from "@/auth/SupabaseAuthProvider";

type Mode = "password" | "code" | "codeSent" | "resetPassword";

export function SupabaseSignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { home, session, access, ready, refreshAccess, error: accessError } = useCockpitAuth();
  const noSeat = ready && session && !access && !accessError
    ? "This account has no active confirmed directory seat. Ask an admin to check your email and seat, then try again."
    : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mode, setMode] = useState<Mode>("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const supabase = getCockpitSupabaseClient();

  const nextDestination = searchParams.get("next");

  const finishLogin = async () => {
    await refreshAccess();
    if (nextDestination) {
      navigate(nextDestination, { replace: true });
    } else if (home) {
      navigate(home, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();

    try {
      if (mode === "password") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (err) {
          setError(err.message === "Invalid login credentials"
            ? "Invalid email or password. Use the email Aziz set you up with, or try an emailed code."
            : err.message);
        } else {
          await finishLogin();
        }
      } else if (mode === "code") {
        const { error: err } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: { shouldCreateUser: false },
        });
        if (err) {
          setError(err.message);
        } else {
          setMode("codeSent");
          setInfo("Check your inbox for a one-time code. It is valid for one hour.");
        }
      } else if (mode === "codeSent") {
        const cleanCode = code.replace(/\D/g, "").slice(-6);
        const { error: err } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: "email",
        });
        if (err) {
          setError("That code did not match. Please check the newest code or request a fresh one.");
        } else {
          await finishLogin();
        }
      } else if (mode === "resetPassword") {
        const { error: err } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (err) {
          setError(err.message);
        } else {
          setInfo("Password updated successfully.");
          await finishLogin();
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="elevated">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supabase-email">Email</Label>
            <Input
              id="supabase-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@maharamedia.com"
              className="h-11"
              disabled={mode === "codeSent"}
            />
          </div>

          {mode === "password" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="supabase-password">Password</Label>
                <button
                  type="button"
                  onClick={() => {
                    setMode("code");
                    setError(null);
                    setInfo(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-primary underline underline-offset-4"
                >
                  Forgot or no password?
                </button>
              </div>
              <Input
                id="supabase-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11"
              />
            </div>
          )}

          {mode === "codeSent" && (
            <div className="space-y-2">
              <Label htmlFor="supabase-code">6-digit Code</Label>
              <Input
                id="supabase-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="123456"
                className="h-11 font-mono tracking-widest text-center"
              />
            </div>
          )}

          {mode === "resetPassword" && (
            <div className="space-y-2">
              <Label htmlFor="supabase-new-password">New Password</Label>
              <Input
                id="supabase-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11"
              />
            </div>
          )}

          {(accessError || error || noSeat) && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
              {accessError || error || noSeat}
            </p>
          )}
          {(accessError || noSeat) && <Button type="button" variant="outline" onClick={() => { void refreshAccess().catch(() => {}); }}>Try again</Button>}

          {info && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-center text-sm text-primary">
              {info}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full h-11">
            {busy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                One moment...
              </>
            ) : mode === "password" ? (
              "Sign In"
            ) : mode === "code" ? (
              "Email me a code"
            ) : mode === "codeSent" ? (
              "Verify and Sign In"
            ) : (
              "Save Password"
            )}
          </Button>

          <div className="flex flex-col gap-2 pt-2">
            {mode === "password" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("code");
                  setError(null);
                  setInfo(null);
                }}
                className="text-xs text-muted-foreground hover:text-primary text-center underline underline-offset-4"
              >
                Sign in with an emailed code instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setError(null);
                  setInfo(null);
                }}
                className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary underline underline-offset-4"
              >
                <ArrowLeft className="size-3" />
                Back to password sign in
              </button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
