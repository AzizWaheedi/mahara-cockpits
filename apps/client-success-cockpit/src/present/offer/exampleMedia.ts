/** These are the team's reviewed Wistia examples, never arbitrary provider frames. */
export function wistiaExample(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return null;
    const match =
      u.hostname === "maharamedia.wistia.com"
        ? /^\/medias\/([a-z0-9]{10})\/?$/.exec(u.pathname)
        : u.hostname === "fast.wistia.net"
          ? /^\/embed\/iframe\/([a-z0-9]{10})\/?$/.exec(u.pathname)
          : null;
    return match ? `https://fast.wistia.net/embed/iframe/${match[1]}` : null;
  } catch {
    return null;
  }
}
const ACTOR_POSTERS: Record<string, string> = {
  qlwysqfu2g: "ee0de9394a4d688f85de81165e1ceb13870c55d2",
  btp2dokvjr: "33e27b2faa619214d4961f7d833a94f98e7a3cdf",
  nix1oq0h3a: "8ecea92509dfb94e6272f3b447f0d3a47aa401b4",
};
/** Full portrait files verified from Wistia media metadata; swatches are tiny blurred previews. */
export function actorPoster(raw: string): string | null {
  const embed = wistiaExample(raw),
    id = embed?.split("/").pop();
  return id && ACTOR_POSTERS[id]
    ? `https://embed-ssl.wistia.com/deliveries/${ACTOR_POSTERS[id]}.jpg`
    : null;
}
