import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFunctions } from 'firebase/functions';
import { firebaseApp } from './firebase';

const appCheckKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckKey) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const graffitiFunctions = getFunctions(firebaseApp, 'us-central1');

export function requireAbuseProtection(): void {
  if (!appCheckKey) {
    throw new Error('Ratings and reporting verification are not configured. Please contact the site administrator.');
  }
}

export function actionError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'The request could not be completed. Please try again.';
}
