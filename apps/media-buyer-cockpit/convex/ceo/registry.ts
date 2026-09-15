import { machine } from "./adapters/machine";
import type { Adapter } from "./types";

/**
 * Every CEO section, in screen order. Each adapter lives in its own file under
 * convex/ceo/adapters and is added here.
 */
export const ADAPTERS: Adapter[] = [machine];
