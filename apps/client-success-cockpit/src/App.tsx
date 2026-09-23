import { AuthStrategyRoutes } from "./auth/AuthStrategyRoutes";
import { SupabaseAuthProvider } from "./auth/SupabaseAuthProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./contexts/ThemeContext";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" switchable>
        <SupabaseAuthProvider>
          <Toaster />
          <AuthStrategyRoutes />
        </SupabaseAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
