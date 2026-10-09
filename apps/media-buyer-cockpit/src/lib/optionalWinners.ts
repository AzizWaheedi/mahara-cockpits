export type OptionalWinners<T> =
  | { status: 'ready'; rows: T }
  | { status: 'unavailable' };

/** A recommendations failure must not replace the client screen. */
export async function loadOptionalWinners<T>(read: () => Promise<T>): Promise<OptionalWinners<T>> {
  try {
    return { status: 'ready', rows: await read() };
  } catch {
    return { status: 'unavailable' };
  }
}
