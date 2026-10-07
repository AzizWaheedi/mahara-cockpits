import type { User as AuthUser } from "@supabase/supabase-js";
import { ChevronRight, Loader2, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  cockpitAuthError,
  completeCockpitPasswordReset,
  requestCockpitPasswordReset,
} from "@/auth/supabaseAccess";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const auth = useCockpitAuth();
  const navigate = useNavigate();
  const emailPasswordAvailable = true;
  const user = { name: auth.name, email: auth.email };

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordStep, setPasswordStep] = useState<"request" | "verify">(
    "request",
  );

  const passwordAttempt = useRef(0);
  const resetActor = useRef<AuthUser | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: actor changes invalidate pending password work.
  useEffect(() => {
    ++passwordAttempt.current;
    resetActor.current = null;
    setPasswordStep("request");
    setLoading(false);
    setError("");
    setSuccess("");
    return () => {
      ++passwordAttempt.current;
      resetActor.current = null;
    };
  }, [auth.session?.user.id, auth.email]);

  useEffect(() => {
    if (!auth.client) return;
    const { data } = auth.client.auth.onAuthStateChange((event, next) => {
      const expected = resetActor.current;
      if (!expected || event === "INITIAL_SESSION") return;
      if (
        next?.user.id === expected.id &&
        next.user.email?.trim().toLowerCase() ===
          expected.email?.trim().toLowerCase()
      )
        return;
      // Invalidate immediately under the SDK callback, before React changes context.
      ++passwordAttempt.current;
      resetActor.current = null;
      setPasswordStep("request");
      setLoading(false);
      setError("The signed-in account changed. Request a new code.");
      setSuccess("");
    });
    return () => {
      data.subscription.unsubscribe();
      ++passwordAttempt.current;
      resetActor.current = null;
    };
  }, [auth.client]);

  const closePasswordDialog = () => {
    ++passwordAttempt.current;
    resetActor.current = null;
    setChangePasswordOpen(false);
    setPasswordStep("request");
    setLoading(false);
    setError("");
    setSuccess("");
  };

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const expected = auth.session?.user;
    const ticket = ++passwordAttempt.current;
    setError("");
    setSuccess("");
    setLoading(true);
    resetActor.current = expected ?? null;
    try {
      if (!auth.client || !expected)
        throw new Error("Sign in again before changing your password.");
      await requestCockpitPasswordReset(auth.client, expected);
      if (passwordAttempt.current !== ticket) return;
      setPasswordStep("verify");
      setSuccess("Enter the code from your newest email.");
    } catch (err: unknown) {
      if (passwordAttempt.current === ticket) setError(cockpitAuthError(err));
    } finally {
      if (passwordAttempt.current === ticket) setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const expected = resetActor.current;
    const ticket = ++passwordAttempt.current;
    const current = () =>
      passwordAttempt.current === ticket && resetActor.current === expected;
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (!auth.client || !expected)
        throw new Error("Request a new password reset code.");
      await completeCockpitPasswordReset(
        auth.client,
        expected,
        String(formData.get("code") ?? ""),
        String(formData.get("newPassword") ?? ""),
        current,
      );
      if (!current()) return;
      setSuccess("Password changed successfully.");
      setTimeout(() => {
        if (current()) closePasswordDialog();
      }, 1500);
    } catch (err: unknown) {
      if (current()) setError(cockpitAuthError(err));
    } finally {
      if (current()) setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError("");

    try {
      await auth.signOut();
      navigate("/");
    } catch {
      setError("Could not sign out. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account and password. Light or dark mode is in your account menu.
        </p>
      </header>

      <section className="rounded-2xl border bg-card">
        <div className="flex items-center gap-4 p-4 sm:p-6">
          <Avatar className="size-12">
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">
              {user?.name?.charAt(0).toUpperCase() || (
                <User className="size-5" />
              )}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">{user?.name || "User"}</p>
            <p className="truncate text-sm text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </div>
        <div className="divide-y border-t">
          {emailPasswordAvailable && (
            <button
              type="button"
              onClick={() => setChangePasswordOpen(true)}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/50 sm:px-6"
            >
              <div>
                <p className="text-sm font-medium">Change password</p>
                <p className="text-sm text-muted-foreground">
                  A code goes to your email first
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-b-2xl px-4 py-4 text-left transition-colors hover:bg-destructive/5 sm:px-6"
          >
            <div>
              <p className="text-sm font-medium text-destructive">Sign out</p>
              <p className="text-sm text-muted-foreground">
                Sign out of this device
              </p>
            </div>
            <ChevronRight className="size-4 text-destructive" />
          </button>
        </div>
      </section>

      {emailPasswordAvailable && (
        <Dialog
          open={changePasswordOpen}
          onOpenChange={open => {
            if (open) setChangePasswordOpen(true);
            else closePasswordDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change password</DialogTitle>
              <DialogDescription>
                {passwordStep === "request"
                  ? "We'll send a verification code to your email."
                  : "Enter the code from your email and your new password."}
              </DialogDescription>
            </DialogHeader>

            {passwordStep === "request" ? (
              <form onSubmit={handleRequestPasswordReset}>
                <div className="py-4">
                  <p className="text-sm text-muted-foreground">
                    A reset code will be sent to:{" "}
                    <span className="font-medium text-foreground">
                      {user?.email}
                    </span>
                  </p>
                </div>
                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-4">
                    {error}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closePasswordDialog}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading && <Loader2 className="size-4 animate-spin" />}
                    Send code
                  </Button>
                </DialogFooter>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    disabled={loading}
                    type="text"
                    placeholder="Enter code from email"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    name="newPassword"
                    disabled={loading}
                    type="password"
                    placeholder="••••••••"
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                {success && (
                  <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">
                    {success}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      ++passwordAttempt.current;
                      resetActor.current = null;
                      setLoading(false);
                      setPasswordStep("request");
                      setError("");
                      setSuccess("");
                    }}
                  >
                    Back
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading && <Loader2 className="size-4 animate-spin" />}
                    Change password
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out</DialogTitle>
            <DialogDescription>
              You can sign in again with your email.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Sign out of this device?
            </p>
          </div>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOutOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSignOut}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
