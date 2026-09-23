import { assets } from "./adapters/assets";
import { b2bAds } from "./adapters/b2bAds";
import { calls } from "./adapters/calls";
import { clients } from "./adapters/clients";
import { delivery } from "./adapters/delivery";
import { expenses } from "./adapters/expenses";
import { growth } from "./adapters/growth";
import { hiring } from "./adapters/hiring";
import { machine } from "./adapters/machine";
import { money } from "./adapters/money";
import { organic } from "./adapters/organic";
import { portal } from "./adapters/portal";
import { team } from "./adapters/team";
import type { Adapter } from "./types";

/**
 * Every CEO section, in screen order. Each adapter lives in its own file under
 * convex/ceo/adapters and is added here.
 */
export const ADAPTERS: Adapter[] = [
  money,
  expenses,
  growth,
  b2bAds,
  delivery,
  calls,
  clients,
  team,
  hiring,
  portal,
  assets,
  organic,
  machine,
];
