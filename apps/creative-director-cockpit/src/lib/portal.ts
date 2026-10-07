const OWN_HOSTS = [
  "mahara-client-success.vercel.app",
  "mahara-creative-director.vercel.app",
];

const PORTAL_URL = "https://cockpit.maharamedia.com";

export function portalUrl(): string {
  const env = (import.meta.env.VITE_PORTAL_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return PORTAL_URL;
  if (!OWN_HOSTS.includes(window.location.host)) return window.location.origin;
  return PORTAL_URL;
}
