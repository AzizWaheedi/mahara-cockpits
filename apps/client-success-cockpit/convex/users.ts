import { v } from "convex/values";
import { authenticatedMutation } from "./functions";

/**
 * Kept so the generated API stays stable, but it no longer deletes anything.
 *
 * The portal is the identity provider: it recreates the user on the next
 * visit and access lives in its member list, so deleting the local rows only
 * signed the person out while promising to "remove all your data".
 */
export const deleteAccount = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async () => {
    throw new Error(
      "Access is managed in the portal. Ask Aziz to remove your seat there.",
    );
  },
});
