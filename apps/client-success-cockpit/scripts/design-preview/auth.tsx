export const useAuthActions = () => ({
  signIn: async () => {
    throw new Error(
      "Authentication is not simulated in this fictional preview.",
    );
  },
  signOut: async () => undefined,
});
export const useAuthToken = () => null;
