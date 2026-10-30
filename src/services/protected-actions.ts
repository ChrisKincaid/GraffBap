import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { firebaseApp } from './firebase';
import { localEmulators } from './local-environment';

const appCheckKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckKey && !localEmulators) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const graffitiFunctions = getFunctions(firebaseApp, 'us-central1');
if (localEmulators) connectFunctionsEmulator(graffitiFunctions, '127.0.0.1', 5001);

export function requireAbuseProtection(): void {
  if (!appCheckKey && !localEmulators) {
    throw new Error('Ratings and reporting verification are not configured. Please contact the site administrator.');
  }
}

export function actionError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'The request could not be completed. Please try again.';
}
