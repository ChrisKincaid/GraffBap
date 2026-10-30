import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('graffbap_welcome_v1', '1'));
  await page.route(/https:\/\/(?:firestore|identitytoolkit|securetoken)\.googleapis\.com\//, async route => {
    throw new Error(`Local test attempted production Firebase access: ${route.request().url()}`);
  });
  await page.goto('/');
  await expect(page.getByText('LOCAL TEST DATA', { exact: true })).toBeVisible();
});

async function login(page: Page, email: string): Promise<void> {
  await page.locator('#landing-account').click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('LocalTest123!');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
}

async function newLocalAccount(page: Page, role: string): Promise<string> {
  const email = `${role}-${Date.now()}@example.test`;
  const response = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-graphbap-local-key',
    { data: { email, password: 'LocalTest123!', returnSecureToken: true } },
  );
  expect(response.ok()).toBe(true);
  return email;
}

async function selectTrainEntry(page: Page, selector: string): Promise<void> {
  const canvas = page.locator(selector);
  // The train starts offscreen. Try points inside the body as it enters.
  await expect(async () => {
    if (await page.locator('#car-card').isVisible()) return;
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Train canvas not visible.');
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55);
    await expect(page.locator('#car-card')).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 20_000, intervals: [600] });
}

test('homepage adds only paired actions and feed choices; competition archives are prominent', async ({ page }) => {
  await expect(page.locator('#competition-tabs')).not.toBeVisible();
  await expect(page.locator('#competitions-start strong')).toHaveText('BATTLES');
  await expect(page.locator('#paint-start strong')).toHaveText('JUST PAINT');
  await expect(page.locator('#top-feed option')).toHaveCount(4);
  await expect(page.locator('#top-feed option[value="all"]')).toHaveText('The Yard');
  await expect(page.locator('#top-feed option[value="weekly"]')).toHaveText("This Week's Battle");
  await expect(page.locator('#top-feed option[value="monthly"]')).toHaveText("This Month's Battle");
  await expect(page.locator('#sc-sort')).toHaveValue('latest');
  await page.locator('#competitions-start').click();
  await expect(page.locator('#competition-tabs')).toBeVisible();
  await expect(page.locator('#paint-start strong')).toHaveText('DO BATTLE');
  await expect(page.locator('#paint-start span')).toHaveText('Paint an entry');
  await expect(page.locator('#reel-title')).toContainText('MONTHLY');
  await expect(page.locator('#subway-title')).toContainText('WEEKLY');
  await expect(page.locator('#competition-tabs button')).toHaveCount(1);
  await expect(page.locator('#competition-view-toggle strong')).toHaveText('Viewing: Current');
  await page.locator('#competition-view-toggle').click();
  await expect(page.locator('#competition-view-toggle strong')).toHaveText('Viewing: Past');
  await expect(page.locator('#competition-view-toggle span')).toHaveText('Click to view Current');
  await expect(page.locator('#monthly-archive')).toBeVisible();
  await expect(page.locator('#weekly-archive')).toBeVisible();
  await expect(page.locator('#monthly-archive option')).not.toHaveCount(0);
  await expect(page.locator('#weekly-archive option')).not.toHaveCount(0);
  await expect(page.locator('#paint-start')).not.toBeVisible();
  await expect(page.locator('#reel-description')).toContainText('Closed');
  await selectTrainEntry(page, '#showcase-canvas');
  await expect(page.locator('#cc-competition-vote')).toBeDisabled();
  await expect(page.locator('#cc-toy')).not.toBeVisible();
  await expect(page.locator('#cc-report')).toBeEnabled();
  await page.locator('#cc-close').click();
  await page.locator('#competition-view-toggle').click();
  await expect(page.locator('#competition-view-toggle strong')).toHaveText('Viewing: Current');
  await expect(page.locator('#paint-start')).toBeVisible();
  await expect(page.locator('#monthly-archive')).not.toBeVisible();
});

test('first-visit welcome briefly introduces battles and terms explain promotional use', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('graffbap_welcome_v1'));
  await page.reload();
  await expect(page.locator('#welcome-dialog')).toBeVisible();
  await expect(page.locator('#welcome-dialog li')).toHaveCount(4);
  await expect(page.locator('#welcome-dialog')).toContainText('Tap Battles to enter weekly or monthly art battles');
  await expect(page.locator('#welcome-dialog')).toContainText('sign in with BoxBap.com to enter battles and vote');
  await page.locator('#welcome-close').click();
  await expect(page.locator('#welcome-dialog')).not.toBeVisible();
  await page.locator('#tos-open').click();
  await expect(page.locator('#tos-dialog')).toBeVisible();
  await expect(page.locator('#tos-dialog')).toContainText('You keep ownership');
  await expect(page.locator('#tos-dialog')).toContainText('non-exclusive, worldwide, royalty-free license');
  await expect(page.locator('#tos-dialog')).toContainText('Graph Bap promotional materials, including social media');
  await expect(page.locator('#tos-dialog')).toContainText('does not apply to unpublished private drafts');
  await page.locator('#tos-close').click();
  await expect(page.locator('#tos-dialog')).not.toBeVisible();
});

test('competition entry requires account sign-in; anonymous option is absent', async ({ page }) => {
  await page.locator('#competitions-start').click();
  await page.locator('#paint-start').click();
  await expect(page.locator('#writer-id')).toBeVisible();
  await expect(page.locator('#wid-anonymous')).not.toBeVisible();
  await page.locator('#wid-dismiss').click();
  await expect(page.locator('#competition-chooser')).not.toBeVisible();
  await login(page, 'voter@example.test');
  await page.locator('#paint-start').click();
  await expect(page.locator('#competition-chooser')).toBeVisible();
  await expect(page.locator('#competition-chooser').getByRole('button', { name: /Monthly: Haunted Yard/ })).toBeEnabled();
  await expect(page.locator('#competition-chooser').getByRole('button', { name: /Weekly: Weekly Wildstyle/ })).toBeEnabled();
});

test('local sign-in explains test accounts and opens competition painter with prefilled credentials', async ({ page }) => {
  await page.locator('#landing-account').click();
  await expect(page.locator('.auth-intro')).toContainText('Your real BoxBap login will not work');
  await expect(page.locator('#auth-email')).toHaveValue('voter@example.test');
  await expect(page.locator('#auth-password')).toHaveValue('LocalTest123!');
  await expect(page.locator('#auth-google')).not.toBeVisible();
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  await page.locator('#competitions-start').click();
  await page.locator('#paint-start').click();
  await expect(page.locator('#enter-weekly')).toBeEnabled();
  await page.locator('#enter-weekly').click();
  await expect(page.locator('#competition-paint-banner')).toContainText('Weekly Wildstyle', { ignoreCase: true });
  await expect(page.locator('#save-car .bar-label')).toHaveText('SUBMIT ENTRY');
  for (const viewport of [{ width: 1440, height: 768 }, { width: 1024, height: 600 }, { width: 844, height: 390 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    const obstructed = await page.locator('#yard-bar button:visible').evaluateAll(buttons => buttons.filter(button => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.left < 0 || rect.right > innerWidth || rect.width <= 0 || !target || !button.contains(target);
    }).map(button => button.id));
    expect(obstructed, `${viewport.width}x${viewport.height}`).toEqual([]);
  }
  await page.locator('#competition-paint-banner').click();
  await expect(page.locator('#competition-details-description')).toContainText('Bring your boldest letters');
  await page.locator('#competition-details').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#competition-details')).not.toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.mouse.move(500, 360);
  await page.mouse.down();
  await page.mouse.move(750, 360, { steps: 20 });
  await page.mouse.up();
  await page.locator('#save-car').click();
  await expect(page.locator('#competition-confirm')).toBeVisible();
  await page.locator('#competition-submit-cancel').click();
});

test('normal painting is unchanged and Ads Only retains promo actions', async ({ page }) => {
  await page.locator('#top-feed').selectOption('ads');
  await expect(page.locator('#reel-title')).toHaveText('ADS ONLY');
  await selectTrainEntry(page, '#showcase-canvas');
  await expect(page.locator('#promo-slide-panel')).toHaveClass(/is-open/);
  await expect(page.locator('#visit-promo-btn')).toBeVisible();
  await page.locator('#cc-close').click();
  await page.locator('#paint-start').click();
  await expect(page.locator('#competition-paint-banner')).not.toBeVisible();
  await expect(page.locator('#save-car .bar-label')).toHaveText('POST');
});

test('competition editor saves draft without publishing and submits only after confirmation', async ({ page }) => {
  await login(page, await newLocalAccount(page, 'painter'));
  await page.locator('#competitions-start').click();
  await page.locator('#paint-start').click();
  await expect(page.locator('#enter-weekly')).toBeEnabled();
  await page.locator('#enter-weekly').click();
  await expect(page.locator('#competition-paint-banner')).toContainText('WEEKLY WILDSTYLE', { ignoreCase: true });
  await expect(page.locator('#save-car .bar-label')).toHaveText('SUBMIT ENTRY');
  const bounds = await page.locator('#viewport').boundingBox();
  if (!bounds) throw new Error('Editor canvas unavailable');
  await page.mouse.move(bounds.width * 0.4, bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.width * 0.6, bounds.height * 0.5, { steps: 25 });
  await page.mouse.up();
  await page.locator('#save-car').click();
  await expect(page.locator('#competition-confirm')).toBeVisible();
  await page.locator('#competition-submit-cancel').click();
  await expect(page).toHaveURL(/#yard$/);
  await page.locator('#back-dispatch').click();
  await page.locator('#paint-start').click();
  await expect(page.locator('#enter-weekly')).toBeEnabled();
  await page.locator('#enter-weekly').click();
  await expect(page.locator('#save-status')).toContainText('draft restored');
  await page.locator('#save-car').click();
  await expect(page.locator('#competition-confirm')).toBeVisible();
  await page.locator('#competition-submit-confirm').click();
  await expect(page).toHaveURL(/#competitions$/, { timeout: 20_000 });
  await page.locator('#paint-start').click();
  await expect(page.locator('#enter-weekly')).toBeDisabled();
  await expect(page.locator('#enter-weekly')).toContainText('Already entered');
});

test('signed-in competition voting is positive-only and reporting reuses existing dialog', async ({ page }) => {
  await login(page, await newLocalAccount(page, 'voter'));
  await page.locator('#competitions-start').click();
  await selectTrainEntry(page, '#showcase-canvas');
  await expect(page.locator('#cc-toy')).not.toBeVisible();
  const vote = page.locator('#cc-competition-vote');
  await expect(vote).toBeEnabled();
  await vote.click();
  await expect(vote).toHaveText('Voted');
  await expect(vote).toBeDisabled();
  await page.locator('#cc-report').click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await page.locator('#report-reason').selectOption('spam');
  await page.locator('#report-submit').click();
  await expect(page.locator('#report-dialog')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#cc-report')).toBeDisabled();
});

test('mobile keeps archive controls and paired actions within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#competitions-start').click();
  await page.locator('#competition-view-toggle').click();
  await expect(page.locator('#monthly-archive')).toBeVisible();
  await expect(page.locator('#weekly-archive')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test('all-time battles show highest-rated competition entries and retain archive access', async ({ page }) => {
  await page.locator('#competitions-start').click();
  await page.locator('#competition-view-toggle').click();
  await expect(page.locator('#monthly-archive option')).toHaveCount(2);
  await expect(page.locator('#weekly-archive option')).toHaveCount(2);
  await page.locator('#monthly-archive').selectOption('all-time');
  await expect(page.locator('#reel-title')).toHaveText('ALL-TIME MONTHLY · TOP 500');
  await selectTrainEntry(page, '#showcase-canvas');
  await expect(page.locator('#cc-competition-status')).toContainText(/Haunted Yard|After Dark/);
  await expect(page.locator('#cc-competition-vote')).toBeDisabled();
  await expect(page.locator('#cc-toy')).not.toBeVisible();
  await page.locator('#cc-close').click();
  await page.locator('#weekly-archive').selectOption('all-time');
  await expect(page.locator('#subway-title')).toHaveText('ALL-TIME WEEKLY · TOP 500');
  await selectTrainEntry(page, '#subway-canvas');
  await expect(page.locator('#cc-competition-status')).toContainText('Weekly Wildstyle');
  await expect(page.locator('#cc-competition-vote')).toBeDisabled();
  await page.locator('#cc-close').click();
  await page.locator('#monthly-info').click();
  await expect(page.locator('#competition-details-description')).toContainText('highest-voted');
  await page.locator('#competition-details').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#monthly-archive').selectOption({ index: 1 });
  await expect(page.locator('#reel-title')).toContainText('ARCHIVE');
});

test('home, current and past keep identical train space with no scrolling or clipped controls', async ({ page }) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 1440, height: 768 }, { width: 1280, height: 720 },
    { width: 1024, height: 600 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 360, height: 640 },
    { width: 844, height: 390 }, { width: 1280, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/#gallery');
    await expect(page.locator('#paint-start strong')).toHaveText('JUST PAINT');
    const trackBounds = await page.locator('.reel-track').evaluateAll(tracks =>
      tracks.map(track => ({ top: track.getBoundingClientRect().top, height: track.getBoundingClientRect().height })));
    for (const view of ['home', 'current', 'past']) {
      if (view === 'current') await page.locator('#competitions-start').click();
      if (view === 'past') await page.locator('#competition-view-toggle').click();
      const layout = await page.evaluate(() => {
        const landing = document.getElementById('landing')!;
        const visibleControls = [...document.querySelectorAll<HTMLElement>('#landing button, #landing select')]
          .filter(element => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden');
        return {
          width: landing.clientWidth, height: landing.clientHeight,
          scrollWidth: landing.scrollWidth, scrollHeight: landing.scrollHeight,
          tracks: [...document.querySelectorAll('.reel-track')].map(track => ({
            top: track.getBoundingClientRect().top, height: track.getBoundingClientRect().height,
          })),
          clipped: visibleControls.filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.top < 0 || rect.left < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1;
          }).map(element => element.id),
        };
      });
      const context = `${viewport.width}x${viewport.height} ${view}`;
      expect(layout.scrollHeight, context).toBeLessThanOrEqual(layout.height + 1);
      expect(layout.scrollWidth, context).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.clipped, context).toEqual([]);
      for (let index = 0; index < trackBounds.length; index++) {
        expect(layout.tracks[index].height, context).toBeGreaterThan(70);
        expect(layout.tracks[index].height, context).toBeCloseTo(trackBounds[index].height, 0);
        expect(layout.tracks[index].top, context).toBeCloseTo(trackBounds[index].top, 0);
      }
    }
  }
});

test('guests can report archived artwork without opening account sign-in', async ({ page }) => {
  await page.locator('#competitions-start').click();
  await page.locator('#competition-view-toggle').click();
  await selectTrainEntry(page, '#subway-canvas');
  await expect(page.locator('#cc-competition-vote')).toBeDisabled();
  await page.locator('#cc-report').click();
  await page.locator('#report-reason').selectOption('other');
  await page.locator('#report-submit').click();
  await expect(page.locator('#report-dialog')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#auth-dialog')).not.toBeVisible();
  await expect(page.locator('#writer-id')).not.toBeVisible();
  await expect(page.locator('#cc-report')).toBeDisabled();
});

test('sparse launch hides empty past choices and unnecessary single-option dropdowns', async ({ page }) => {
  const root = 'http://127.0.0.1:8080/v1/projects/demo-graphbap/databases/main/documents';
  const headers = { Authorization: 'Bearer owner' };
  const restore: { name: string; fields: Record<string, unknown> }[] = [];
  async function patch(name: string, fields: Record<string, unknown>): Promise<void> {
    const mask = Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&');
    const response = await page.request.patch(`http://127.0.0.1:8080/v1/${name}?${mask}`, { headers, data: { fields } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  try {
    const carsResponse = await page.request.get(`${root}/graffiti_cars?pageSize=1000`, { headers });
    expect(carsResponse.ok()).toBe(true);
    const cars = (await carsResponse.json()).documents ?? [];
    for (const car of cars) {
      if (!car.fields.competitionId) continue;
      restore.push({ name: car.name, fields: { competitionVotes: car.fields.competitionVotes } });
      await patch(car.name, { competitionVotes: { integerValue: '0' } });
    }
    await page.locator('#competitions-start').click();
    await page.locator('#competition-view-toggle').click();
    await expect(page.locator('#monthly-archive option')).toHaveCount(1);
    await expect(page.locator('#weekly-archive option')).toHaveCount(1);
    await expect(page.locator('#monthly-archive')).not.toBeVisible();
    await expect(page.locator('#weekly-archive')).not.toBeVisible();
    await expect(page.locator('#reel-title')).toContainText('After Dark');
    await expect(page.locator('#subway-title')).toContainText('Weekly Wildstyle');
    const competitionsResponse = await page.request.get(`${root}/graffiti_competitions?pageSize=1000`, { headers });
    expect(competitionsResponse.ok()).toBe(true);
    for (const competition of (await competitionsResponse.json()).documents ?? []) {
      if (competition.fields.status.stringValue !== 'archived') continue;
      restore.push({ name: competition.name, fields: {
        results: competition.fields.results, entryCount: competition.fields.entryCount,
      } });
      await patch(competition.name, { results: { arrayValue: { values: [] } }, entryCount: { integerValue: '0' } });
    }
    await expect(page.locator('#monthly-archive option')).toHaveCount(0);
    await expect(page.locator('#weekly-archive option')).toHaveCount(0);
    await expect(page.locator('#reel-title')).toContainText('No past battles yet');
    await expect(page.locator('#subway-title')).toContainText('No past battles yet');
    await expect(page.locator('#monthly-info')).not.toBeVisible();
    await page.locator('#competition-view-toggle').click();
    await expect(page.locator('#paint-start')).toBeVisible();
    await expect(page.locator('#reel-title')).toContainText('Haunted Yard');
  } finally {
    for (const item of restore.reverse()) await patch(item.name, item.fields);
  }
});
