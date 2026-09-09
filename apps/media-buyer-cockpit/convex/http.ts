// PHI console redaction (active only on PHI deployments).
import "./phiLogging";
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
// Registers Convex Auth's routes, including the OAuth endpoints used by
// "Sign in with Viktor": /api/auth/signin/viktor and /api/auth/callback/viktor.
auth.addHttpRoutes(http);

export default http;
