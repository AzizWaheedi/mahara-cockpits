import { Link } from "react-router";
import { SignIn } from "@/components/SignIn";
import { Button } from "@/components/ui/button";
import { ViktorSignInSection } from "@/components/ViktorSignInSection";
import {
  getEmailPasswordSignInAvailable,
  getViktorSignInAvailable,
} from "@/lib/viktor-spaces-access/config";

function getLoginProviderState(): {
  emailPasswordAvailable: boolean;
  viktorSignInAvailable: boolean;
  invalidProviderConfiguration: boolean;
} {
  try {
    return {
      emailPasswordAvailable: getEmailPasswordSignInAvailable(),
      viktorSignInAvailable: getViktorSignInAvailable(),
      invalidProviderConfiguration: false,
    };
  } catch {
    return {
      emailPasswordAvailable: false,
      viktorSignInAvailable: false,
      invalidProviderConfiguration: true,
    };
  }
}

export function LoginPage() {
  const {
    emailPasswordAvailable,
    viktorSignInAvailable,
    invalidProviderConfiguration,
  } = getLoginProviderState();
  const signInUnavailable = !emailPasswordAvailable && !viktorSignInAvailable;

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto size-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="text-primary-foreground font-bold text-lg">M</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground text-sm">
            Sign in to your account to continue
          </p>
        </div>

        {!invalidProviderConfiguration && <ViktorSignInSection />}
        {emailPasswordAvailable && <SignIn />}
        {signInUnavailable && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-center">
            {invalidProviderConfiguration
              ? "Sign-in is unavailable: this app has no valid sign-in provider configuration. Contact the app owner."
              : 'Sign-in is unavailable: this app only offers "Sign in with Viktor", but its Viktor sign-in configuration is missing from this build. Contact the app owner.'}
          </p>
        )}

        {emailPasswordAvailable && (
          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Button variant="link" className="p-0 h-auto font-medium" asChild>
              <Link to="/signup">Sign up</Link>
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}
