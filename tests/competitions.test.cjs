const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

function extract(names, context) {
  const selected = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length, 'Functions must stay at module scope.');
  const script = ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scope = vm.createContext(context);
  vm.runInContext(script, scope);
  return scope;
}

test('competition draft saves never publish or submit, including leave/visibility saves', async () => {
  const saved = [];
  const context = extract(['saveNow'], {
    console, savePending: true, paintingCompetition: { id: 'monthly-2026-10' },
    currentYard: 'train', currentCarIndex: 0, saveStatus: {},
    saveChain: Promise.resolve(), localKey: () => 'competition/user/monthly-2026-10/train/0',
    saveLocalCar: async (...args) => saved.push(args),
    actionError: error => error.message,
    showToast: () => assert.fail('Unexpected draft failure'),
    publishPiece: () => assert.fail('A draft must not publish'),
    submitCompetition: () => assert.fail('A draft must not submit'),
  });
  context.saveNow({ toBlob: callback => callback('draft-bytes') });
  await context.saveChain;
  assert.equal(context.savePending, false);
  assert.equal(saved[0][0], 'competition/user/monthly-2026-10/train/0');
  assert.match(context.saveStatus.textContent, /not submitted/);
});

test('competition vote path cannot reach ordinary Props/Toys backend', () => {
  const messages = [];
  const context = extract(['castVote'], { showToast: text => messages.push(text) });
  context.castVote({ reg: { competitionId: 'weekly-2026-10-26' } }, 'toy', () => {});
  assert.match(messages[0], /no downvotes/);
});

test('confirmation reuses the full selected train renderer and clears the old preview', () => {
  const calls = [];
  const preview = { width: 800, height: 240, getContext: () => ({
    clearRect: (...args) => calls.push(['clear', ...args]),
    drawImage: (...args) => calls.push(['draw', ...args]),
  }) };
  const image = { width: 800, height: 204 };
  const paintLayer = {};
  const context = extract(['confirmCompetitionEntry'], {
    paintingCompetition: { title: 'Weekly Wildstyle' }, car: () => ({ hasPaint: true }),
    competitionOpen: () => true, competitionDeadline: () => 'Monday', currentYard: 'subway',
    currentCarIndex: 3, CAR_WIDTH: 4000, paintLayer,
    baseIdFor: (yard, index) => {
      assert.equal(yard, 'subway');
      assert.equal(index, 3);
      return 103;
    },
    renderCarImage: (...args) => { calls.push(['render', ...args]); return image; },
    document: { getElementById: id => id === 'competition-confirm-preview' ? preview : {} },
    submitDialog: { showModal: () => calls.push(['open']) },
    showToast: () => assert.fail('Unexpected confirmation rejection'),
  });
  context.confirmCompetitionEntry();
  context.confirmCompetitionEntry();
  assert.equal(preview.height, 204);
  assert.deepEqual(calls.slice(0, 4), [
    ['render', 103, paintLayer, true, 0.2], ['clear', 0, 0, 800, 204],
    ['draw', image, 0, 0], ['open'],
  ]);
  assert.deepEqual(calls.slice(4), calls.slice(0, 4));
});

test('Ads Only bypasses artwork queries and returns every active ad once', async () => {
  const context = extract(['specialFeed'], {
    competitionView: false, feedSelection: { top: 'ads' }, promoReady: Promise.resolve(),
    specialPagers: {},
    watchReelCompetition() {}, selectedCompetition: () => undefined, allTimeCompetitionFeed: () => false,
    promoService: { getActiveAds: () => [
      { id: 'one', imageUrl: 'image1', linkUrl: 'https://example.test/1' },
      { id: 'two', imageUrl: 'image2', linkUrl: 'https://example.test/2' },
    ] },
  });
  const entries = await context.specialFeed('top');
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.isPromo && !entry.sub));
  assert.equal(entries[1].id, 'two');
});

test('competition reels include both divisions, normal filters respect their division', async () => {
  const cars = [
    { id: 'freight', division: 'freight', writerUid: 'a' },
    { id: 'subway', division: 'subway', writerUid: 'b' },
  ];
  const context = extract(['specialFeed'], {
    competitionView: true, feedSelection: { top: 'monthly' },
    specialPagers: {},
    watchReelCompetition() {},
    allTimeCompetitionFeed: () => false,
    selectedCompetition: () => ({ id: 'month' }), archivesView: false,
    competitionOpen: () => true, competitionStart: () => 'month_seed',
    competitionPager: (id, division, uid, kind, start) => {
      assert.equal(id, 'month', 'Only entries with the selected competition ID may be requested.');
      assert.equal(start, 'month_seed', 'Current battles must use the stable mixed order.');
      return { next: async () => cars.filter(car => !division || car.division === division) };
    },
    myWork: { top: false }, regEntries: entries => entries,
  });
  assert.equal((await context.specialFeed('top')).length, 2);
  context.competitionView = false;
  assert.equal((await context.specialFeed('top'))[0].id, 'freight');
  assert.equal((await context.specialFeed('top')).length, 1);
});

test('a battle keeps the same random start across reloads and filters during a visit', () => {
  let draws = 0;
  const context = extract(['competitionStart'], {
    competitionStarts: new Map(),
    crypto: { getRandomValues: bytes => { bytes.fill(++draws); return bytes; } },
    Uint8Array,
  });
  const first = context.competitionStart('weekly_2026-10-26');
  assert.match(first, /^weekly_2026-10-26_[a-f0-9]{64}$/);
  assert.equal(context.competitionStart('weekly_2026-10-26'), first);
  assert.notEqual(context.competitionStart('monthly_2026-10'), first);
  assert.equal(draws, 2);
});

test('live vote changes update loaded cars beyond the first thirty without reshuffling', () => {
  const entries = Array.from({ length: 64 }, (_, i) => ({
    reg: { id: `entry-${i}`, competitionId: 'week', competitionVotes: 0 },
  }));
  const calls = [];
  let receive;
  const context = extract(['watchReelCompetition'], {
    entrySubscriptions: {}, roll: { entries }, subwayReel: { entries: [] },
    watchCompetitionEntries: (ids, callback) => {
      calls.push(Array.from(ids));
      receive = callback;
      return () => {};
    },
    refreshCard() {}, renderCompetitionHeadings() {},
    reloadReel: () => assert.fail('Vote changes must not restart or reorder the reel'),
    console, showToast: () => assert.fail('Unexpected subscription failure'),
  });
  context.watchReelCompetition('top', 'week');
  assert.equal(calls[0].length, 64);
  receive([{ id: 'entry-63', competitionId: 'week', competitionVotes: 100, status: 'departed' }]);
  assert.equal(entries[63].reg.competitionVotes, 100);
  assert.equal(entries[63].reg.id, 'entry-63');
  context.watchReelCompetition('top', 'week');
  assert.equal(calls.length, 1, 'Already loaded entries must not be subscribed twice');
});

test('mixed pagination traverses all 1000 entries across the random start with no vote-order bias or duplicates', async () => {
  const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'competitions.ts'), 'utf8');
  const serviceAst = ts.createSourceFile('competitions.ts', serviceSource, ts.ScriptTarget.Latest, true);
  const pager = serviceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'competitionPager');
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `week_${i.toString(16).padStart(64, '0')}`,
    data: () => ({ status: 'departed', competitionVotes: i === 0 ? 9999 : 0 }),
  }));
  const start = rows[725].id;
  const scope = vm.createContext({
    exports: {}, db: {}, collection: () => ({}), documentId: () => '__name__',
    where: (...args) => ({ where: args }), orderBy: (...args) => ({ order: args }),
    limit: count => ({ limit: count }), startAfter: doc => ({ after: doc.id }),
    query: (...constraints) => constraints,
    getDocs: async constraints => {
      assert.deepEqual(constraints.filter(item => item.order).map(item => item.order), [['__name__']]);
      assert.ok(constraints.some(item => item.where?.[0] === 'competitionId' && item.where[2] === 'week'));
      const [, op, pivot] = constraints.find(item => item.where?.[0] === '__name__').where;
      const after = constraints.find(item => item.after)?.after;
      const count = constraints.find(item => item.limit).limit;
      const docs = rows.filter(row => (op === '>=' ? row.id >= pivot : row.id < pivot) && (!after || row.id > after)).slice(0, count);
      return { docs, size: docs.length };
    },
  });
  vm.runInContext(ts.transpileModule(pager.getText(serviceAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  for (const pivot of [start, 'week_' + '0'.repeat(64), 'week_' + 'f'.repeat(64)]) {
    const feed = scope.competitionPager('week', undefined, undefined, undefined, pivot);
    const ids = [];
    while (!feed.done) ids.push(...(await feed.next(30)).map(car => car.id));
    assert.equal(ids.length, 1000);
    assert.equal(new Set(ids).size, 1000);
    assert.deepEqual([...ids].sort(), rows.map(row => row.id));
    assert.equal((await feed.next(30)).length, 0);
    if (pivot === start) {
      assert.equal(ids[0], rows[725].id);
      assert.equal(ids[275], rows[0].id, 'Highest votes cannot move an entry ahead of the random sequence');
    }
  }
});

test('live subscriptions include every loaded ID in batches of thirty and report removed entries', () => {
  const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'competitions.ts'), 'utf8');
  const serviceAst = ts.createSourceFile('competitions.ts', serviceSource, ts.ScriptTarget.Latest, true);
  const helper = serviceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'watchCompetitionEntries');
  const batches = [], received = [];
  let stopped = 0;
  const scope = vm.createContext({
    exports: {}, db: {}, collection: () => ({}), documentId: () => '__name__',
    where: (...args) => ({ where: args }), query: (...constraints) => constraints,
    onSnapshot: (constraints, receive) => {
      const batch = constraints.find(item => item.where).where[2];
      batches.push(Array.from(batch));
      receive({ docs: batch.filter(id => id !== 'entry-63').map(id => ({
        id, data: () => ({ status: 'departed', competitionVotes: 10 }),
      })) });
      return () => stopped++;
    },
  });
  vm.runInContext(ts.transpileModule(helper.getText(serviceAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  const ids = Array.from({ length: 65 }, (_, i) => `entry-${i}`);
  const stop = scope.watchCompetitionEntries(ids, (cars, missing) => received.push({
    cars: Array.from(cars), missing: Array.from(missing),
  }), () => assert.fail('Unexpected subscription failure'));
  assert.deepEqual(batches.map(batch => batch.length), [30, 30, 5]);
  assert.deepEqual(batches.flat(), ids);
  assert.equal(received.flatMap(batch => batch.cars).length, 64);
  assert.deepEqual(received.flatMap(batch => batch.missing), ['entry-63']);
  stop();
  assert.equal(stopped, 3);
});

test('this-week and this-month filters cannot fall back to older competitions', () => {
  const context = extract(['currentCompetition', 'selectedCompetition'], {
    competitions: [
      { id: 'old-week', kind: 'weekly', opensAt: 1, status: 'archived' },
      { id: 'this-week', kind: 'weekly', opensAt: 2, status: 'open' },
      { id: 'this-month', kind: 'monthly', opensAt: 2, status: 'open' },
    ],
    competitionOpen: item => item.status === 'open',
    competitionView: false, archivesView: false,
    feedSelection: { top: 'weekly', sub: 'monthly' },
  });
  assert.equal(context.selectedCompetition('top').id, 'this-week');
  assert.equal(context.selectedCompetition('sub').id, 'this-month');
  context.competitions = context.competitions.filter(item => item.status === 'archived');
  assert.equal(context.selectedCompetition('top'), undefined);
  assert.equal(context.selectedCompetition('sub'), undefined);
});

test('all-time battles use the ranked capped pager without injecting promos', async () => {
  const context = extract(['specialFeed'], {
    competitionView: true, feedSelection: { top: 'all' }, specialPagers: {},
    watchReelCompetition() {}, allTimeCompetitionFeed: () => true,
    selectedCompetition: () => undefined, myWork: { top: false },
    competitionPager: (id, division, uid, kind) => {
      assert.equal(id, null);
      assert.equal(division, undefined);
      assert.equal(kind, 'monthly');
      return { next: async count => { assert.equal(count, 30); return [{ id: 'ranked' }]; } };
    },
    regEntries: entries => entries,
  });
  assert.equal((await context.specialFeed('top'))[0].id, 'ranked');
});

test('all-time paging ranks by competition votes and never reads beyond 500', async () => {
  const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'competitions.ts'), 'utf8');
  const serviceAst = ts.createSourceFile('competitions.ts', serviceSource, ts.ScriptTarget.Latest, true);
  const pager = serviceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'competitionPager');
  const rows = Array.from({ length: 530 }, (_, index) => ({
    id: `entry-${index}`, data: () => ({ status: 'departed', competitionVotes: 530 - index }),
  }));
  let fetched = 0;
  const scope = vm.createContext({
    db: {}, collection: () => ({}), documentId: () => '__name__',
    where: (...args) => ({ where: args }), orderBy: (...args) => ({ order: args }),
    limit: count => ({ limit: count }), startAfter: doc => ({ after: doc.id }),
    query: (...constraints) => constraints,
    getDocs: async constraints => {
      assert.ok(constraints.some(item => item.where?.[0] === 'competitionVotes' && item.where[1] === '>'));
      assert.ok(constraints.some(item => item.where?.[0] === 'competitionKind' && item.where[2] === 'monthly'));
      assert.ok(constraints.some(item => item.order?.[0] === 'competitionVotes' && item.order[1] === 'desc'));
      const count = constraints.find(item => item.limit).limit;
      const docs = rows.slice(fetched, fetched + count);
      fetched += docs.length;
      return { docs, size: docs.length };
    },
  });
  vm.runInContext(ts.transpileModule(pager.getText(serviceAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText.replace('export ', ''), Object.assign(scope, { exports: {} }));
  const result = scope.competitionPager(null, undefined, undefined, 'monthly');
  const entries = [];
  while (!result.done) entries.push(...await result.next(30));
  assert.equal(entries.length, 500);
  assert.equal(fetched, 500);
  assert.equal(entries[0].competitionVotes, 530);
  assert.equal(entries.at(-1).competitionVotes, 31);
  assert.equal((await result.next(30)).length, 0);
});

test('past choices exclude empty, fully moderated, pending and current competitions', () => {
  const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'competitions.ts'), 'utf8');
  const serviceAst = ts.createSourceFile('competitions.ts', serviceSource, ts.ScriptTarget.Latest, true);
  const helper = serviceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'pastCompetitions');
  const scope = vm.createContext({ exports: {} });
  vm.runInContext(ts.transpileModule(helper.getText(serviceAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  const base = { kind: 'weekly', closesAt: 50, status: 'archived' };
  const items = [
    { ...base, id: 'zero-votes-visible', results: [{ eligible: true, votes: 0 }] },
    { ...base, id: 'empty', entryCount: 0, results: [] },
    { ...base, id: 'all-hidden', entryCount: 100, results: [{ eligible: false }] },
    { ...base, id: 'pending', status: 'open', results: [{ eligible: true }] },
    { ...base, id: 'future', closesAt: 150, results: [{ eligible: true }] },
    { ...base, id: 'other-kind', kind: 'monthly', results: [{ eligible: true }] },
  ];
  assert.deepEqual(Array.from(scope.pastCompetitions(items, 'weekly', 100), item => item.id), ['zero-votes-visible']);
});

test('existing opposing train direction and speed formulas remain unchanged', () => {
  assert.ok(source.includes('r.x += (r.showcase ? -1 : 1) * ROLL_SPEED * ROLL_SPEEDS[r.speedIdx]!.rate * dt'));
  assert.ok(source.includes('subwayReel.sx -= ROLL_SPEED * ROLL_SPEEDS[subwayReel.speedIdx]!.rate * scale * dt'));
  assert.ok(source.includes('x: showcase ? (entries?.length ?? CAR_COUNT) * CAR_WIDTH : -L.W / L.scale'));
});

function sharingModule() {
  const code = fs.readFileSync(path.join(root, 'src', 'services', 'entry-sharing.ts'), 'utf8');
  const warnings = [];
  const context = vm.createContext({ exports: {}, URL, Error, console: { warn: (...args) => warnings.push(args) } });
  vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { ...context.exports, warnings };
}

test('entry routes validate permanent IDs and share URLs keep the current host without query data', () => {
  const sharing = sharingModule();
  assert.equal(sharing.entryRouteId('#competitions'), null);
  assert.equal(sharing.entryRouteId('#entry=weekly_123_abc'), 'weekly_123_abc');
  for (const hash of ['#entry=', '#entry=../../secret', '#entry=<script>', '#entry=' + 'a'.repeat(129)]) {
    assert.equal(sharing.entryRouteId(hash), '');
  }
  assert.equal(sharing.entryShareUrl('weekly_123_abc', 'https://graffbap.boxbap.com/?token=private#competitions'),
    'https://graffbap.boxbap.com/#entry=weekly_123_abc');
  assert.equal(sharing.entryShareUrl('test', 'http://127.0.0.1:5174/#gallery'),
    'http://127.0.0.1:5174/#entry=test');
  assert.throws(() => sharing.entryShareUrl('../no', 'https://example.test'), /valid share link/);
});

test('native sharing uses restrained copy, cancellation does not copy, and denied clipboard shows a usable link', async () => {
  const sharing = sharingModule();
  const url = 'https://graffbap.boxbap.com/#entry=entry1';
  let payload;
  assert.equal(await sharing.shareEntryLink(url, {
    share: async data => { payload = data; },
  }, () => assert.fail('Unexpected manual fallback')), 'shared');
  assert.equal(payload.text, 'Check my piece. Drop a vote.');
  assert.equal(payload.url, url);
  const cancelled = new Error('Cancelled');
  cancelled.name = 'AbortError';
  assert.equal(await sharing.shareEntryLink(url, {
    share: async () => { throw cancelled; },
    clipboard: { writeText: () => assert.fail('Cancellation must not copy a link') },
  }, () => assert.fail('Cancellation must not open another dialog')), 'cancelled');
  let copied;
  assert.equal(await sharing.shareEntryLink(url, { clipboard: {
    writeText: async value => { copied = value; },
  } }, () => assert.fail('Unexpected manual fallback')), 'copied');
  assert.equal(copied, url);
  let manual;
  assert.equal(await sharing.shareEntryLink(url, {
    share: async () => { throw new Error('Unavailable'); },
    clipboard: { writeText: async () => { throw new Error('Denied'); } },
  }, value => { manual = value; }), 'manual');
  assert.equal(manual, url);
  assert.equal(sharing.warnings.length, 2);
});

test('sign-in resumes a battle vote on the captured artwork ID rather than the passing car', async () => {
  const entry = { reg: { id: 'chosen', competitionId: 'week', status: 'departed', writerUid: 'artist' } };
  let pending;
  const voted = [];
  const context = extract(['castCompetitionVote'], {
    cardEntryAt: () => entry, cardCar: 0, competitions: [{ id: 'week' }],
    competitionOpen: () => true, signedIn: () => false,
    requireAuth: callback => { pending = callback; },
    currentUser: { uid: 'voter' }, competitionVoteBusy: null, sharedEntry: null,
    refreshCard() {}, renderSharedEntry() {},
    roll: { entries: [entry] }, subwayReel: { entries: [] },
    voteCompetition: async id => { voted.push(id); return { votes: 1, already: false }; },
    localStorage: { setItem() {} }, showToast() {}, console,
  });
  context.castCompetitionVote();
  context.cardEntryAt = () => ({ reg: { id: 'different', competitionId: 'week' } });
  context.signedIn = () => true;
  pending();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(voted, ['chosen']);
  assert.equal(entry.reg.competitionVotes, 1);
});
