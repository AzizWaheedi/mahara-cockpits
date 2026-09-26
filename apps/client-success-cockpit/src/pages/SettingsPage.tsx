import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { ChevronRight, Loader2, Moon, Palette, Sun, User } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/kit";
import { portalUrl } from "@/components/PortalAutoSignIn";
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
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { getEmailPasswordSignInAvailable } from "@/lib/viktor-spaces-access/config";
import { api } from "../../convex/_generated/api";

export function SettingsPage() {
  const user = useQuery(api.auth.currentUser);
  const { theme, toggleTheme, switchable } = useTheme();
  const { signIn } = useAuthActions();
  const emailPasswordAvailable = getEmailPasswordSignInAvailable();

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
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

    const formData = new FormData();
    formData.append("email", user?.email || "");
    formData.append("flow", "reset");

    try {
      await signIn("password", formData);
      setPasswordStep("verify");
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
    formData.append("email", user?.email || "");
    formData.append("flow", "reset-verification");

    try {
      await signIn("password", formData);
      setSuccess("Password changed.");
      setTimeout(() => {
        setChangePasswordOpen(false);
        setPasswordStep("request");
        setSuccess("");
      }, 1500);
    } catch {
      setError("Invalid code or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Settings"
        sub="Your account and how the cockpit looks"
      />

      <div className="max-w-2xl space-y-6">
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="bg-primary text-lg text-primary-foreground">
                {user?.name?.charAt(0).toUpperCase() || (
                  <User className="size-6" />
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
        </section>

        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Palette className="size-4 text-muted-foreground" />
            Appearance
          </h2>
          <div className="mt-4">
            {switchable ? (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-4">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-full bg-secondary flex items-center justify-center">
                    {theme === "light" ? (
                      <Moon className="size-5 text-foreground" />
                    ) : (
                      <Sun className="size-5 text-foreground" />
                    )}
                  </div>
                  <div>
                    <Label htmlFor="dark-mode" className="font-medium">
                      Dark mode
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Switch between light and dark
                    </p>
                  </div>
                </div>
                <Switch
                  id="dark-mode"
                  checked={theme === "dark"}
                  onCheckedChange={toggleTheme}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Theme follows your system preference
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <User className="size-4 text-muted-foreground" />
            Account
          </h2>
          <div className="mt-4 space-y-3">
            {emailPasswordAvailable && (
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="w-full flex items-center justify-between rounded-xl bg-muted/40 p-4 transition-colors hover:bg-muted text-left"
              >
                <div>
                  <p className="font-medium text-sm">Change password</p>
                  <p className="text-sm text-muted-foreground">
                    Update your password
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            )}
            {/* Access lives in the portal's member list, not here: deleting the
              local user only signed the person out and the portal recreated
              it on the next visit. */}
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="font-medium text-sm">Your seat</p>
              <p className="text-sm text-muted-foreground">
                Who can open this cockpit, and which clients they see, is set in
                the{" "}
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href={`${portalUrl()}/admin`}
                >
                  portal
                </a>
                . Ask Aziz to change or remove your access there.
              </p>
            </div>
          </div>
        </section>
      </div>

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
    </div>
  );
}
