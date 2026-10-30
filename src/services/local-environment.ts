export const localEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

if (localEmulators && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  throw new Error('Local emulator mode must only run on localhost.');
}
