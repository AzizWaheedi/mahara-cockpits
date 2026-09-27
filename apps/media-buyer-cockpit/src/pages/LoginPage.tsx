import { Link } from "react-router";
import { SupabaseSignIn } from "@/components/SupabaseSignIn";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";

export function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-6">
            <Wordmark size="lg" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to Mahara
          </h1>
          <p className="text-muted-foreground text-sm">
            One sign-in for every cockpit. Use the email Aziz set you up with;
            your cockpit opens on its own.
          </p>
        </div>

        <SupabaseSignIn />

        <p className="text-center text-sm text-muted-foreground">
          First time here?{" "}
          <Button variant="link" className="p-0 h-auto font-medium" asChild>
            <Link to="/first-sign-in">Set up your password</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
