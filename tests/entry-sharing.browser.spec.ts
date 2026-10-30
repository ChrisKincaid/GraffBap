import { expect, test, type Page } from '@playwright/test';

const root = 'http://127.0.0.1:8080/v1/projects/demo-graphbap/databases/main/documents';
const headers = { Authorization: 'Bearer owner' };
const artistHash = '349f3cdeda4e6977988c213ab9dcae173735e804eef0fd508cc143fb9c567114';
const subwayHash = '9e09b2fcc7a8409294deb8f445f27399e146b4cf5ce5db1c378b208ba1392182';
const weekly = `weekly_2026-10-26_${artistHash}`;
const monthly = `monthly_2026-10_${subwayHash}`;
const archived = `monthly_2026-08_${artistHash}`;

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/(?:firestore|identitytoolkit|securetoken)\.googleapis\.com\//, async route => {
    throw new Error(`Local sharing test attempted production Firebase access: ${route.request().url()}`);
  });
});

async function openEntry(page: Page, id = weekly): Promise<void> {
  await page.goto(`/#entry=${id}`);
  await expect(page.locator('#shared-entry')).toBeVisible();
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
  await expect(page.locator('#shared-entry-status')).toContainText('votes');
}

async function login(page: Page, email: string): Promise<void> {
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('LocalTest123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
}

test('fresh guest opens the exact full train without a welcome wall; links survive refresh, Back and mobile sizes', async ({ page }) => {
  await openEntry(page);
  await expect(page.locator('#welcome-dialog')).not.toBeVisible();
  await expect(page.locator('#shared-entry-title')).toHaveText('Weekly Wildstyle');
  await expect(page.locator('#shared-entry-vote')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`#entry=${weekly}$`));
  expect(await page.locator('#toolbar').evaluate(element => element.inert)).toBe(true);
  const pixels = await page.locator('#shared-entry-preview').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0);
  });
  expect(pixels).toBe(true);
  const writer = await page.locator('#shared-entry-writer').textContent();
  for (const size of [{ width: 390, height: 844 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#shared-entry-browse')).toBeInViewport();
    await expect(page.locator('#shared-entry-vote')).toBeInViewport();
  }
  await page.reload();
  await expect(page.locator('#shared-entry-writer')).toHaveText(writer!);
  await page.locator('#shared-entry-browse').click();
  await expect(page).toHaveURL(/#competitions$/);
  await expect(page.locator('#shared-entry')).not.toBeVisible();
  expect(await page.locator('#toolbar').evaluate(element => element.inert)).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#entry=${weekly}$`));
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
  await page.goto(`/#entry=${monthly}`);
  await expect(page.locator('#shared-entry-title')).toHaveText('Haunted Yard');
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
});

test('native share and denied-clipboard fallback provide a permanent entry link without navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      localStorage.setItem('test-shared-entry', JSON.stringify(data));
    } });
  });
  await openEntry(page);
  await page.locator('#shared-entry-share').click();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('test-shared-entry')!));
  expect(data.text).toBe('Check my piece. Drop a vote.');
  expect(data.url).toBe(`http://127.0.0.1:5174/#entry=${weekly}`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard blocked in this test'); },
    } });
  });
  await page.locator('#shared-entry-share').click();
  await expect(page.locator('#entry-share-dialog')).toBeVisible();
  await expect(page.locator('#entry-share-link')).toHaveValue(data.url);
  await page.locator('#entry-share-close').click();
  await expect(page).toHaveURL(new RegExp(`#entry=${weekly}$`));
});

test('guest can cancel sign-in, then sign in and vote on this exact entry without losing the train', async ({ page }) => {
  const email = `share-voter-${Date.now()}@example.test`;
  const account = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-graphbap-local-key',
    { data: { email, password: 'LocalTest123!', returnSecureToken: true } },
  );
  expect(account.ok()).toBe(true);
  await openEntry(page);
  const writer = await page.locator('#shared-entry-writer').textContent();
  await page.locator('#shared-entry-vote').click();
  await expect(page.locator('#writer-id')).toBeVisible();
  await page.locator('#wid-dismiss').click();
  await expect(page.locator('#shared-entry-vote')).toBeEnabled();
  await page.locator('#shared-entry-vote').click();
  await page.locator('#wid-continue').click();
  await page.locator('#auth-cancel').click();
  await expect(page).toHaveURL(new RegExp(`#entry=${weekly}$`));
  await page.locator('#shared-entry-vote').click();
  await page.locator('#wid-continue').click();
  const voted = page.waitForRequest(request => request.url().endsWith('/competitionVote'));
  await login(page, email);
  const request = await voted;
  expect(request.postDataJSON().data.id).toBe(weekly);
  await expect(page.locator('#shared-entry-vote')).toHaveText('Voted');
  await expect(page.locator('#shared-entry-vote')).toBeDisabled();
  await expect(page.locator('#shared-entry-writer')).toHaveText(writer!);
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
  await page.reload();
  await expect(page.locator('#shared-entry-vote')).toHaveText('Voted');
});

test('owner and archived entry links show artwork but cannot vote; reporting remains guest-friendly', async ({ page }) => {
  await openEntry(page);
  await page.locator('#shared-entry-account').click();
  await login(page, 'artist@example.test');
  await expect(page.locator('#shared-entry-vote')).toHaveText('Your Entry');
  await expect(page.locator('#shared-entry-vote')).toBeDisabled();
  await page.goto(`/#entry=${archived}`);
  await expect(page.locator('#shared-entry-status')).toContainText('Voting closed');
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
  await expect(page.locator('#shared-entry-vote')).toBeDisabled();
  await expect(page.locator('#shared-entry-share')).toBeVisible();
  await page.locator('#shared-entry-report').click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await expect(page.locator('#writer-id')).not.toBeVisible();
  await page.locator('#report-cancel').click();
});

test('a guest can report a shared archived entry without an account', async ({ page }) => {
  await openEntry(page, archived);
  await page.locator('#shared-entry-report').click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await page.locator('#report-reason').selectOption('spam');
  await page.locator('#report-submit').click();
  await expect(page.locator('#report-dialog')).not.toBeVisible();
  await expect(page.locator('#shared-entry-report')).toBeDisabled();
  await expect(page.locator('#writer-id')).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#entry=${archived}$`));
});

test('the existing battle car panel shares the selected entry without changing the train route', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('graffbap_welcome_v1', '1');
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => localStorage.setItem('test-copied-entry', value),
    } });
  });
  await page.goto('/#competitions');
  await expect(async () => {
    if (await page.locator('#car-card').isVisible()) return;
    const bounds = await page.locator('#subway-canvas').boundingBox();
    if (!bounds) throw new Error('Battle train is unavailable');
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55);
    await expect(page.locator('#car-card')).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 20_000, intervals: [600] });
  const writer = (await page.locator('.cc-by').textContent())!.replace(/^by /, '');
  await page.locator('#cc-competition-share').click();
  const url = await page.evaluate(() => localStorage.getItem('test-copied-entry'));
  expect(url).toMatch(/#entry=weekly_2026-10-26_/);
  await expect(page).toHaveURL(/#competitions$/);
  await page.goto(url!);
  await expect(page.locator('#shared-entry-writer')).toHaveText(`by ${writer}`);
});

test('changing shared entries during sign-in cannot submit a vote for the old or the new entry', async ({ page }) => {
  const votes: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/competitionVote')) votes.push(request.url()); });
  await openEntry(page);
  await page.locator('#shared-entry-vote').click();
  await page.locator('#wid-continue').click();
  await page.evaluate(id => { location.hash = `#entry=${id}`; }, monthly);
  await login(page, 'voter@example.test');
  await expect(page.locator('#shared-entry-title')).toHaveText('Haunted Yard');
  await expect(page.locator('#shared-entry-preview')).toBeVisible();
  await expect(page.locator('#shared-entry-vote')).toBeEnabled();
  expect(votes).toHaveLength(0);
});

test('artwork decode failures are visible and retry restores the entry', async ({ page }) => {
  const response = await page.request.get(`${root}/graffiti_cars/${monthly}`, { headers });
  const { fields } = await response.json();
  const patch = async (value: unknown) => {
    const result = await page.request.patch(`${root}/graffiti_cars/${monthly}?updateMask.fieldPaths=image`, {
      headers, data: { fields: { image: value } },
    });
    expect(result.ok()).toBe(true);
  };
  try {
    await patch({ stringValue: 'data:image/png;base64,invalid' });
    await page.goto(`/#entry=${monthly}`);
    await expect(page.locator('#shared-entry-error')).toContainText('could not load');
    await expect(page.locator('#shared-entry-retry')).toBeVisible();
    await patch(fields.image);
    await page.locator('#shared-entry-retry').click();
    await expect(page.locator('#shared-entry-preview')).toBeVisible();
    await expect(page.locator('#shared-entry-error')).toBeEmpty();
  } finally {
    await patch(fields.image);
  }
});

test('invalid, missing and moderated entries do not expose artwork, and a live moderation change removes it', async ({ page }) => {
  for (const id of ['bad%2Fpath', 'no-such-entry']) {
    await page.goto(`/#entry=${id}`);
    await expect(page.locator('#shared-entry-title')).toHaveText('Piece unavailable');
    await expect(page.locator('#shared-entry-error')).not.toBeEmpty();
    await expect(page.locator('#shared-entry-preview')).not.toBeVisible();
    await expect(page.locator('#shared-entry-vote')).not.toBeVisible();
  }
  const response = await page.request.get(`${root}/graffiti_cars/${monthly}`, { headers });
  const { fields } = await response.json();
  const patch = async (value: unknown) => {
    const result = await page.request.patch(`${root}/graffiti_cars/${monthly}?updateMask.fieldPaths=status`, {
      headers, data: { fields: { status: value } },
    });
    expect(result.ok()).toBe(true);
  };
  await openEntry(page, monthly);
  try {
    await patch({ stringValue: 'buffed' });
    await expect(page.locator('#shared-entry-title')).toHaveText('Piece unavailable');
    await expect(page.locator('#shared-entry-preview')).not.toBeVisible();
    await page.reload();
    await expect(page.locator('#shared-entry-title')).toHaveText('Piece unavailable');
  } finally {
    await patch(fields.status);
  }
});
