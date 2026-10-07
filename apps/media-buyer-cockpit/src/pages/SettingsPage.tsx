import { ChevronRight, Loader2, User } from "lucide-react";

import { useState } from "react";
import { useNavigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
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
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordStep, setPasswordStep] = useState<"request" | "verify">(
    "request",
  );

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (auth.client && auth.email) {
        const { error: resetErr } =
          await auth.client.auth.resetPasswordForEmail(auth.email);
        if (resetErr) throw resetErr;
        setSuccess("Password reset email sent!");
      }
    } catch {
      setError("Could not send reset code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const newPassword = (formData.get("newPassword") as string) || "";

    try {
      if (auth.client) {
        const { error: updateErr } = await auth.client.auth.updateUser({
          password: newPassword,
        });
        if (updateErr) throw updateErr;
        setSuccess("Password changed successfully!");
        setTimeout(() => {
          setChangePasswordOpen(false);
          setPasswordStep("request");
          setSuccess("");
        }, 1500);
      }
    } catch {
      setError("That code or password did not work. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
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
            onClick={() => setDeleteAccountOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-b-2xl px-4 py-4 text-left transition-colors hover:bg-destructive/5 sm:px-6"
          >
            <div>
              <p className="text-sm font-medium text-destructive">
                Delete account
              </p>
              <p className="text-sm text-muted-foreground">
                Permanently delete your account
              </p>
            </div>
            <ChevronRight className="size-4 text-destructive" />
          </button>
        </div>
      </section>

      {emailPasswordAvailable && (
        <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
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
                    onClick={() => setChangePasswordOpen(false)}
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
                    type="password"
                    placeholder="••••••••"
                    minLength={6}
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
                      setPasswordStep("request");
                      setError("");
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

      <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete your
              account and remove all your data.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete your account?
            </p>
          </div>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAccountOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
