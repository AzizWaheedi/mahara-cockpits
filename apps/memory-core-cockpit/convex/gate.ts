import { envOrNull } from "./tools";

/**
 * Who may open the memory core.
 *
 * This is a personal tool with exactly one reader, so there is no user table:
 * the door is one access code that lives on the deployment as
 * MEMORY_CORE_ACCESS_CODE, and every query, mutation and action checks it on
 * the server. Hiding a screen in the browser is not the lock.
 *
 * Deviation from the other cockpits, on purpose: they sign people in with
 * Convex Auth and read roles from a members table, because they have several
 * people with different jobs. This one has one person and no roles to read.
 */

/** The actor written on every audit row, so the log always says who changed what. */
export const OPERATOR = "aziz@maharamedia.com";

const NO_CODE_SET =
  "This deployment has no access code yet, so it is closed to everyone. Set one with: bunx convex env set MEMORY_CORE_ACCESS_CODE <code>";

const WRONG_CODE =
  "That access code did not work. Open Sources, then Access, and paste the code again.";

/**
 * Check the code and return who is acting. Throws a sentence a person can act
 * on — never a bare 401.
 */
export function requireOperator(code: string | undefined): string {
  const expected = envOrNull("MEMORY_CORE_ACCESS_CODE");
  if (!expected) throw new Error(NO_CODE_SET);
  const given = (code ?? "").trim();
  if (!given || !sameSecret(given, expected)) throw new Error(WRONG_CODE);
  return OPERATOR;
}

/** Is the code right, without throwing — for the unlock screen. */
export function codeIsRight(code: string | undefined): boolean {
  const expected = envOrNull("MEMORY_CORE_ACCESS_CODE");
  if (!expected) return false;
  const given = (code ?? "").trim();
  return Boolean(given) && sameSecret(given, expected);
}

export function hasAccessCode(): boolean {
  return Boolean(envOrNull("MEMORY_CORE_ACCESS_CODE"));
}

/** Compare without leaking where the first difference is. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
