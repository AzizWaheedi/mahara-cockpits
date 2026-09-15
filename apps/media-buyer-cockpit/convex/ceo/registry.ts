import { calls } from "./adapters/calls";
import { clients } from "./adapters/clients";
import { delivery } from "./adapters/delivery";
import { growth } from "./adapters/growth";
import { machine } from "./adapters/machine";
import { money } from "./adapters/money";
import { portal } from "./adapters/portal";
import { team } from "./adapters/team";
import type { Adapter } from "./types";

/**
 * Every CEO section, in screen order. Each adapter lives in its own file under
 * convex/ceo/adapters and is added here.
 */
export const ADAPTERS: Adapter[] = [
  money,
  growth,
  delivery,
  calls,
  clients,
  team,
  portal,
  machine,
];
