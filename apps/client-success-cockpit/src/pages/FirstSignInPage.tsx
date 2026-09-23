import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/Wordmark";
import { getCockpitSupabaseClient, useCockpitAuth } from "@/auth/SupabaseAuthProvider";

type SetupStep = "requestOtp" | "verifyAndSetPassword" | "complete";

export function FirstSignInPage() {
  const navigate = useNavigate();
  const { refreshAccess } = useCockpitAuth();
  const supabase = getCockpitSupabaseClient();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<SetupStep>("requestOtp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatusMessage(null);

    const cleanEmail = email.trim().toLowerCase();

    try {
      const { data: member, error: memberErr } = await supabase
        .from("cockpit_members")
        .select("email,active")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (memberErr || !member || !member.active) {
        setError("This email does not have an active cockpit seat. Ask Aziz to add you in the portal first.");
        setBusy(false);
        return;
      }

      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: false },
      });

      if (otpErr) {
        setError(otpErr.message);
      } else {
        setStep("verifyAndSetPassword");
        setStatusMessage(`A setup code has been sent to ${cleanEmail}. Enter it below along with your chosen password.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate password setup.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyAndSetPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.replace(/\D/g, "").slice(-6);

    try {
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: "email",
      });

      if (verifyErr || !data.session) {
        setError(verifyErr?.message ?? "Invalid or expired code. Please request a new code.");
        setBusy(false);
        return;
      }

      await supabase.rpc("cockpit_link_confirmed_member", {
        p_user_id: data.session.user.id,
      });

      const { error: pwdErr } = await supabase.auth.updateUser({
        password,
      });

      if (pwdErr) {
        setError(`Seat linked, but setting password failed: ${pwdErr.message}`);
      } else {
        setStep("complete");
        await refreshAccess();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to complete account setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-6">
            <Wordmark size="lg" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Account Setup
          </h1>
          <p className="text-muted-foreground text-sm">
            Set your password for your Mahara Cockpits seat.
          </p>
        </div>

        <Card variant="elevated">
          <CardContent className="pt-6">
            {step === "requestOtp" && (
              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="setup-email">Your Work Email</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="name@maharamedia.com"
                    className="h-11"
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={busy} className="w-full h-11">
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Checking seat...
                    </>
                  ) : (
                    "Send Setup Code"
                  )}
                </Button>

                <div className="text-center pt-2">
                  <Button variant="link" className="p-0 h-auto text-xs" asChild>
                    <Link to="/login">
                      <ArrowLeft className="mr-1 size-3" />
                      Back to sign in
                    </Link>
                  </Button>
                </div>
              </form>
            )}

            {step === "verifyAndSetPassword" && (
              <form onSubmit={handleVerifyAndSetPassword} className="space-y-4">
                {statusMessage && (
                  <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                    {statusMessage}
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="setup-code">Verification Code</Label>
                  <Input
                    id="setup-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="123456"
                    className="h-11 font-mono tracking-widest text-center"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-password">Choose Password</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="h-11"
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={busy} className="w-full h-11">
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Securing seat...
                    </>
                  ) : (
                    "Save Password & Open Cockpit"
                  )}
                </Button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("requestOtp");
                      setError(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-primary underline underline-offset-4"
                  >
                    Change email or resend code
                  </button>
                </div>
              </form>
            )}

            {step === "complete" && (
              <div className="space-y-4 text-center py-4">
                <CheckCircle2 className="mx-auto size-12 text-primary" />
                <h2 className="text-lg font-semibold">Seat Ready</h2>
                <p className="text-sm text-muted-foreground">
                  Your password has been saved and your cockpit seat is verified.
                </p>
                <Button
                  onClick={() => navigate("/dashboard", { replace: true })}
                  className="w-full h-11"
                >
                  Enter Cockpit
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
