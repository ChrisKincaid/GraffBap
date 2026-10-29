import { ensureAnonymous } from './services/firebase';
import { reportRegistryCar, type ReportReason } from './services/registry';
import { actionError } from './services/protected-actions';

interface CaptchaApi {
  ready(callback: () => void): void;
  render(container: HTMLElement, options: { sitekey: string }): number;
  getResponse(widget: number): string;
  reset(widget: number): void;
}

declare global {
  interface Window { grecaptcha?: CaptchaApi }
}

const dialog = document.getElementById('report-dialog') as HTMLDialogElement;
const form = document.getElementById('report-form') as HTMLFormElement;
const reason = document.getElementById('report-reason') as HTMLSelectElement;
const message = document.getElementById('report-error')!;
const submit = document.getElementById('report-submit') as HTMLButtonElement;
const cancel = document.getElementById('report-cancel') as HTMLButtonElement;
const captchaContainer = document.getElementById('report-captcha')!;
let widget: number | undefined;
let captchaLoading: Promise<CaptchaApi> | null = null;
let selectedId: string | null = null;
let finish: ((result: 'already' | 'reported' | null) => void) | null = null;

async function showChallenge(): Promise<void> {
  const sitekey = import.meta.env.VITE_REPORT_RECAPTCHA_SITE_KEY;
  if (!sitekey) throw new Error('Report verification is not configured. Please contact the site administrator.');
  captchaContainer.hidden = false;
  if (widget !== undefined) return;
  if (!captchaLoading) {
    captchaLoading = new Promise<CaptchaApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
      script.async = true;
      const timeout = window.setTimeout(() => {
        script.remove();
        reject(new Error('Verification did not load. Check your connection and try again.'));
      }, 15_000);
      script.onload = () => {
        const api = window.grecaptcha;
        if (!api || typeof api.ready !== 'function') {
          window.clearTimeout(timeout);
          reject(new Error('Verification is unavailable.'));
        } else api.ready(() => {
          window.clearTimeout(timeout);
          resolve(api);
        });
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        script.remove();
        reject(new Error('Verification could not load. Check your connection and try again.'));
      };
      document.head.append(script);
    }).catch(err => {
      captchaLoading = null;
      throw err;
    });
  }
  const api = await captchaLoading;
  widget = api.render(captchaContainer, { sitekey });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedId || submit.disabled) return;
  submit.disabled = cancel.disabled = true;
  message.textContent = '';
  try {
    await ensureAnonymous();
    const captchaToken = widget === undefined ? undefined : window.grecaptcha?.getResponse(widget);
    const result = await reportRegistryCar(selectedId, reason.value as ReportReason, captchaToken);
    finish?.(result);
    finish = null;
    dialog.close();
  } catch (err) {
    console.error('Report failed', err);
    message.textContent = actionError(err);
    if (widget !== undefined) window.grecaptcha?.reset(widget);
    if (typeof err === 'object' && err !== null && 'details' in err &&
        typeof err.details === 'object' && err.details !== null &&
        'challengeRequired' in err.details && err.details.challengeRequired === true) {
      try {
        await showChallenge();
      } catch (challengeError) {
        console.error('Report verification failed', challengeError);
        message.textContent = actionError(challengeError);
      }
    }
  } finally {
    submit.disabled = cancel.disabled = false;
  }
});

cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => {
  if (submit.disabled) event.preventDefault();
});
dialog.addEventListener('close', () => {
  selectedId = null;
  finish?.(null);
  finish = null;
});

export function reportArtwork(id: string): Promise<'already' | 'reported' | null> {
  if (dialog.open) return Promise.resolve(null);
  selectedId = id;
  form.reset();
  message.textContent = '';
  if (widget !== undefined) window.grecaptcha?.reset(widget);
  dialog.showModal();
  return new Promise(resolve => { finish = resolve; });
}
