const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false, value: (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('file:')) return originalFetch(input, init);
  throw new Error('Offline smoke forbids live network calls. Inject a provider transport fixture.');
} });
