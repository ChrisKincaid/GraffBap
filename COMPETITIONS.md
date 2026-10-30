# Competitions

Local development and the production release use separate configurations. Do not deploy
hosting by itself: the competition callables, scheduler, indexes, and reviewed
rules changes must be released together after approval.

## Local preview

- Graph Bap: `http://127.0.0.1:5174`
- Admin: `http://127.0.0.1:4201`
- Firebase Emulator UI: `http://127.0.0.1:4000`

Only the explicit local configurations connect to `demo-graphbap` emulators.
Ordinary `npm run dev` still uses the shared production Firebase project.
The local Graph Bap preview displays **LOCAL TEST DATA**.
Never use a real password in the local preview.

Start the backend emulator stack and seed following
[backend instructions](../BoxBap/Public/functions/COMPETITIONS.md).
Then start Graph Bap from this folder:

```powershell
npm run dev:local
```

Start Admin from `BoxBap\Admin`:

```powershell
npm exec -- ng serve --configuration local --host 127.0.0.1 --port 4201
```

Fake local accounts include `artist@example.test`, `voter@example.test`, and
`admin@example.test`, all with password `LocalTest123!`. These are disposable
emulator-only credentials. The admin account has local superadmin permissions.
Graph Bap's local sign-in dialog explains the test environment and prefills
`voter@example.test` / `LocalTest123!`, so clicking Sign In is enough to start.
Google/GitHub options are hidden only in emulator mode. Real BoxBap credentials
do not authenticate against these disposable test accounts.
Seed resets only the demo emulator data; do not run it during a browser test.

## Using the UI

The normal home screen retains opposing train movement. The central buttons are
Battles (left) and Just Paint / Paint for fun (right). Ordinary painting and POST retain their
existing behavior. Each line's Show dropdown also offers current weekly/monthly
competition entries and Ads Only. These compact, train-header-styled dropdowns
sit at the right end of the existing reel controls, not in the middle.
The homepage has exactly four feed choices:
- The Yard: existing public feed for that train type, including
  ordinary art, competition entries and injected promos; not a competition-only
  leaderboard. Newest first by default, with no age cutoff; existing
  Latest/Best rated/etc. sorting is preserved (normal ratings).
- This Week's Battle / This Month's Battle: exact current
  competition ID, that train type, ranked by competition votes. These filters
  never fall back to a previous competition if no current one exists.
- Ads Only: active promos, without artwork.

Competitions reuses the train reels: monthly at the top and Weekly Wildstyle
at the bottom, each accepting freight and subway artwork. No promos are injected
into these views. Archives and All-Time feeds page in leaderboard order rather
than downloading the full collection.
Open battles instead page through the full battle in a stable mixed order:
entry IDs contain a server-generated SHA-256 hash of the writer UID. Each visit
picks a random starting hash, walks IDs in order, and wraps once to the beginning.
The same starting point is retained across filters and Current/Past navigation
until the page is reloaded. Vote changes do not change positions or reset the
train. This includes all entries, not just a shuffle of the highest-voted batch,
without downloading up to 1,000 inline images at once. Live totals remain visible
for loaded entries, including entries beyond the first thirty. New submissions
can appear on a subsequent page load/revisit; they do not restart an active reel.
The ordinary Yard feed/sorts and final ranking/tie rules are unchanged.

A single toggle in the existing top header shows "Viewing: Current" and
"Click to view Past", reversing both labels when clicked. It adds no page row.
The page remains fixed-screen: no scrolling or extra space taken from either
train. Each reel retains its original 36px header area. Info opens the full theme,
deadline and rules without expanding the train headers. Past shows dated
selectors, final results and the winning artist; entries remain reportable but
competition voting and submissions are closed.

Past also offers separate All-Time Weekly / All-Time Monthly Top 500 feeds,
including both train types, positive competition votes only, across all dates
(including entries in current battles). These use the server-owned
`competitionKind` field; ordinary art cannot enter these rankings.
Only archives with visible eligible entries are listed. Empty or fully moderated
archives are omitted; zero-vote visible archives remain browsable. All-time
options appear only while a matching positive-voted visible entry exists.
With one available choice, its artwork displays without a redundant dropdown.
With none, that reel says "No past battles yet." Current battles remain visible
even before their first entry, so users can participate. Availability follows
live data/moderation; no production filler artwork is generated.

The first-visit welcome adds one short Battles sentence and names Just Paint.
Its existing dismissal key is unchanged, so returning visitors are not forced to
see it again. The terms preserve artist ownership and grant a non-exclusive,
worldwide, royalty-free license for published artwork/battle entries to be
displayed/shared on-site and in Graph Bap promotions, including social media,
with resizing/cropping. Private unpublished drafts are excluded. Battle rules
and moderation corrections are also mentioned. This is draft terms wording for
legal review, not a guarantee of enforceability or a new assent mechanism.

Do Battle (subtext: Paint an entry) requires an account, then asks weekly/monthly and train/subway.
The existing editor displays the competition/theme/deadline banner and replaces
POST with SUBMIT ENTRY. It saves competition drafts on this device only until
explicit confirmation. Drafts are separated from normal artwork and account
identities. Submitted snapshots cannot be repainted. After refreshing an active
competition editor, choose Do Battle again to resume the local draft.
Confirmation shows the selected train/subway with its paint using the same
compositor as train exports; uploads still contain only the paint layer.
Battle creation/submission timestamps come from the server, not the device clock.
The competition indicator is a compact dark "BATTLE: title" button in the existing
top action bar, not a floating yellow overlay. Click it for the full theme and
deadline. It shrinks/ellipsizes before any action buttons, keeping Submit usable.
Battle details dialogs live outside the hidden landing page so their controls
remain interactive from the editor.

One account may submit once per competition. Each competition has a maximum of
**1,000 entries**, displayed with its current count. Competition voting is
positive-only, separate from ordinary Props/Toys, with no self-votes.
Reports reuse the same artwork ID and existing moderation queue.

Deadlines are Monday 00:00 to next Monday 00:00 for weekly and first-of-month
00:00 to next first-of-month 00:00 for monthly, all America/Chicago time,
including daylight saving. Server checks close both submissions and votes even
if the lifecycle job is delayed. September logo submission/export and header
rotation remain gated until that separate feature is implemented.

## Validation

```powershell
npm run test:competitions
npm run test:browser
npm run build
```

Browser tests require the local emulator stack, seeded current and past sample
artwork, and `npm run dev:local`. They use Microsoft Edge through Playwright.
Backend date tests inject time to verify rollover without changing the computer
clock. They include cutoff, DST, archive, eligibility and retry behavior.

The local browser suite passed all fifteen scenarios, including sparse launch,
separate weekly/monthly all-time rankings, and eight viewport sizes
checking identical train geometry across Home/Current/Past, no page scrolling,
and unclipped controls. It mutates demo entries,
votes, and reports; reseed before a complete rerun and after testing to restore
the sample showcase. Frontend build and all fourteen competition unit checks pass,
including the all-time pager's exact 500-entry ceiling.
Mixed-order tests traverse all 1,000 entries at middle/before-first/after-last
starting points without duplicates or omissions, and live changes update the
selected car without closing it or restarting its train.
Freight and subway submission checks skew the client clock a minute ahead/behind,
verify server-owned timestamps and paint-only uploads, and check full-car previews.

Local tests do not establish production Cloud Scheduler delivery or real
App Check/CAPTCHA operation. Production deployment requires a separate approved,
scoped release and review of the proposed rules, preserving unrelated live rules.
