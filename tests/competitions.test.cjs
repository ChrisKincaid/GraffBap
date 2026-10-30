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
    selectedCompetition: () => ({ id: 'month' }),
    competitionPager: (id, division) => {
      assert.equal(id, 'month', 'Only entries with the selected competition ID may be requested.');
      return { next: async () => cars.filter(car => !division || car.division === division) };
    },
    myWork: { top: false }, regEntries: entries => entries,
  });
  assert.equal((await context.specialFeed('top')).length, 2);
  context.competitionView = false;
  assert.equal((await context.specialFeed('top'))[0].id, 'freight');
  assert.equal((await context.specialFeed('top')).length, 1);
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
