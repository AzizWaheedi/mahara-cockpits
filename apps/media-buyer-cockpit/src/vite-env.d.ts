/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_VIKTOR_AUTH_CLIENT_ID?: string;
  readonly VITE_VIKTOR_SPACES_ACCESS_MODE?: string;
  readonly VITE_VIKTOR_SPACES_API_URL?: string;
  readonly VITE_VIKTOR_SPACES_AUTH_PROVIDERS?: string;
  readonly VITE_VIKTOR_SPACES_SPACE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "virtual:pwa-register" {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: any) => void;
    onRegisterError?: (error: any) => void;
  }
  export function registerSW(
    options?: RegisterSWOptions,
  ): (reloadPage?: boolean) => Promise<void>;
}
