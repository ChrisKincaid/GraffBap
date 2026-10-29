# Ratings, reports, and reversible report ignores

Activated and verified in production: 2026-10-29.

## Current release

- Live Graph Bap: <https://graffbap.boxbap.com> (also `graff-bap.web.app`).
  Live Admin: <https://boombapboombox-admin.web.app/graffiti-moderation>.
- Deployed only the two hosting sites, the five graffiti callables, and Firestore
  database `main` rules. Public hosting, other Functions, recorder, Storage rules,
  and RTDB rules were not deployed.
- The rules were merged against a backup of the user's manually updated LIVE
  rules, not the earlier local proposal. All 21 unrelated collection rule blocks,
  including existing real-user customer restrictions and public-yard constraints,
  were compared and preserved. The prior release was checked again before writing.
- Both verification keys, App Check provider, required APIs, Secret Manager
  secrets/access, allowed hosts, and `graffiti_rate_limits.expiresAt` TTL are
  configured. The required Hall of Fame index was already READY; no indexes changed.
- Production keys are public build settings in ignored `.env.production`.
  The backend hostname setting is in ignored
  `Public/functions/.env.boombapboombox-a5b78`. Secret values remain in Secret Manager.
  Allowed hosts: `graffbap.boxbap.com`, `graff-bap.web.app`, and
  `graff-bap.firebaseapp.com`. The shared Firebase web app is registered for
  App Check; no project-wide Firestore/Storage enforcement was enabled.
- The separate report key was provisioned as an Enterprise CHECKBOX key with
  its retrieved legacy secret. The existing classic `api.js` widget and
  `siteverify` backend were verified together with a real successful challenge.
- Live isolated checks passed: guest report -> Admin active queue; guest rating
  denied; account vote/deduplication/switch; direct report-counter write denied;
  ignore suppresses count growth; restore plus a new CAPTCHA-verified reporter
  reopens the queue; Admin Ignored items and Restore buttons; anonymous publish,
  owner autosave, and retirement with the active counter returning to its baseline.
- Temporary artwork, report/vote records, role document, and three explicitly
  created test Auth accounts were removed. Normal rate-window records expire
  through TTL. A subsequent user-approved adjustment reset only the report
  network window started by these tests and the three test-reporter windows;
  no vote/publication quotas or actual reports were removed.
- Eighteen backend/policy/emulator checks passed against the merged rules,
  including regressions for the user's existing customer/comment restrictions.
  Seven focused Admin tests and all three affected builds passed.

Refresh already-open Graph Bap/Admin tabs after this release. Old Graph Bap
clients write counts directly and are intentionally rejected by the new rules.
Moderators still need the existing `graffiti-moderation` role permission;
superadmin access remains available. Do not broaden permissions to mask a denial.

The deployment CLI warns that the existing Node.js 20 Functions runtime will be
decommissioned on 2026-10-30, and that legacy `functions.config()` is deprecated.
These shared-backend migrations remain separate work; existing commerce Functions
were not modified or redeployed during this release.

## Behavior

- Anonymous visitors can browse, paint, publish, and report. Ratings require a
  non-anonymous BoxBap account, enforced by the UI and callable backend.
- Shared ratings allow one choice per account/car; switching replaces the vote.
  Switching does not repeatedly add recent-voter activity to the car's score.
- Reports require a reason and deduplicate by Firebase UID/car. New anonymous
  identities are not proof of new people; network-based limits apply as well.
- Reports never automatically quarantine artwork. Existing quarantined items
  remain off the tracks until a moderator uses Keep / Clear.
- Admin's Ignore future reports applies to an artwork, not a reporter. It
  suppresses future report records/count increments without removing the artwork.
- Ignored items has its own view with moderator UID/time and Restore reporting.
  Restoring snapshots the current count: old reports do not reopen the queue,
  while the next accepted new report does. Lifetime per-UID/car deduplication
  remains; a previous reporter does not get a fresh vote/report simply on restore.
- Keep / Clear preserves the existing threshold of 15 additional reports.
  Buff removes a car from rolling feeds and adjusts active/HoF counters once.
- Local/demo preset cars have no shared moderation record; their Report control
  is disabled instead of claiming a nonexistent report was sent.

### Abuse limits

Enforced transactionally per UID **and** per keyed network hash:

| Action | Ten-minute window | Daily window |
| --- | --- | --- |
| Reports | 20 | 100 |
| Ratings, including switches | 60 | 500 |
| New published cars | 5 | 20 |

These are fixed-duration windows starting with the first counted action, not an
exact sliding-window guarantee. Duplicate/ignored report requests consume quota;
unchanged duplicate ratings do not. Reporting after the first ten counted
requests in the daily UID or network window requires a reCAPTCHA v2 checkbox.
Guests sharing a connection share the network budget.

On 2026-10-29, after the first live release, the user approved raising reports
from 5/10 minutes and 20/day to 20/10 minutes and 100/day, and moving CAPTCHA
from attempt 4 to attempt 11. Only `graffitiReport` was redeployed. All 18
backend/policy/emulator checks passed with the updated thresholds. The initial
production tests had used four attempts from the same network budget before
the user's first report; their second attempt hit the old five-attempt ceiling.
Only those test-origin windows were reset so testing could resume.

App Check is required on rating/report callables. CAPTCHA is verified server-side,
including an explicit hostname allowlist. Raw IP addresses are not stored:
network IDs are HMACs using a Secret Manager key. Rate-limit records are private.
This reduces abuse; it does not guarantee one account per human or eliminate
distributed denial-of-service attacks. Rate limits and `maxInstances` are not
hard billing caps.

## Code ownership

- Graph Bap: [registry client](src/services/registry.ts),
  [App Check setup](src/services/protected-actions.ts),
  [report dialog](src/report-dialog.ts), and [main UI](src/main.ts).
- BoxBap Admin: [moderation screen](../BoxBap/Admin/src/app/graffiti-moderation/graffiti-moderation.ts)
  and [service](../BoxBap/Admin/src/app/services/graffiti-moderation.service.ts).
- Backend: [graffiti callables](../BoxBap/Public/functions/src/graffiti.ts),
  exported by [functions index](../BoxBap/Public/functions/src/index.ts).
- Authoritative checked-in Firestore rules:
  [Public/firestore.rules](../BoxBap/Public/firestore.rules), database `main`.
  Graph Bap owns [composite indexes](firestore.indexes.json).
- The Admin invitation signup transaction/rules were tightened because
  client-assigned roles would otherwise bypass moderator authorization.
  Existing role assignment, permission inheritance, and disabled-user checks remain.

The five new callables are `graffitiVote`, `graffitiReport`, `graffitiModerate`,
`graffitiPublish`, and `graffitiRetire`, in `us-central1`. Identity always comes
from the verified authentication context, never a caller-supplied UID.
Publishing/retiring moved server-side so score fields and lifecycle counters can
be protected without breaking anonymous painting/posting.
Only the writer's image/timestamp autosave remains a permitted direct registry
update, and only while the car is `departed` (not Hall of Fame or moderated away).

## Configuration reference for future releases

1. Register the Graph Bap Firebase web app in Firebase App Check with a
   **reCAPTCHA Enterprise** provider. Authorize the real hosting/custom domains.
   Put the public Enterprise site key in `VITE_FIREBASE_APPCHECK_SITE_KEY`.
   Do not enable project-wide Firestore/Storage App Check enforcement blindly:
   the other apps have not been wired for that.
2. Register a separate **reCAPTCHA v2-compatible checkbox** site for elevated reports.
   The deployed Enterprise CHECKBOX key uses `retrieveLegacySecretKey` and the
   classic widget/siteverify integration; do not mix it with an assessments-only
   backend without updating both client and server.
   Put its public site key in `VITE_REPORT_RECAPTCHA_SITE_KEY`.
   Use [.env.example](.env.example) as the template for a local, ignored env file.
   Vite embeds these keys at build time; rebuild after changes.
3. Configure secrets through Firebase Secret Manager, not chat, source, or env
   templates. From Public/functions, with the intended Firebase account:
   - `firebase functions:secrets:set GRAFFITI_ABUSE_SECRET --project boombapboombox-a5b78`
   - `firebase functions:secrets:set GRAFFITI_RECAPTCHA_SECRET --project boombapboombox-a5b78`
   The first is a newly generated high-entropy secret; the second is the v2
   checkbox secret paired with the frontend's v2 site key. Rotating the abuse
   secret resets network identities/budgets.
4. Copy the [functions env template](../BoxBap/Public/functions/.env.example) to
   an ignored `.env` in that directory. Set `GRAFFITI_CAPTCHA_HOSTS` to an exact,
   comma-separated hostname allowlist (no scheme, port, or path).
5. Enable Firestore TTL for collection group `graffiti_rate_limits`, field
   `expiresAt`, in database `main` for automatic old-budget cleanup.
   Expiry is enforced by application timestamps independently of TTL cleanup.
6. Confirm the production service account can access both secrets and Firestore
   `main`. Confirm anonymous Auth and the intended login providers are enabled.
   For local App Check debugging use Firebase's registered debug-token procedure;
   never add a production bypass or commit a debug token.

Missing verification configuration produces a visible error; it never silently
falls back to unprotected voting/reporting.

## Deployment / rollout

Before every future rules deployment, compare the checked-in full Public ruleset
with the current deployed `main` rules and merge any newer manual protections.
A blind replacement could discard live-only changes. No Storage/RTDB changes
are required for this feature.

Use a coordinated maintenance window: old clients write counts directly, whereas
new clients call Functions. The new rules intentionally reject old mutation
paths; ask existing visitors to refresh. Deploy the new Admin build with the
rules change because invitation signup now consumes its code atomically.

Suggested sequence after configuration and rule comparison:

1. Check required indexes first. The `status/net/hofAt` index supports server-side
   HoF retirement and was already READY during activation. Deploy indexes only
   if a required one is missing; never delete unrelated indexes.
2. From Public/functions, `npm run build`.
3. From Public, deploy **only** the five new functions with explicit project:
   `firebase deploy --only functions:graffitiVote,functions:graffitiReport,functions:graffitiModerate,functions:graffitiPublish,functions:graffitiRetire --project boombapboombox-a5b78`.
4. Build Admin and Graph Bap with the correct configuration; deploy their hosting
   sites and the reviewed Firestore `main` rules together in the maintenance
   window. Do not deploy unrelated Public hosting, Stripe functions, or Storage.
5. Smoke-test on the real Graph Bap domain: guest rating prompts for login;
   guest report reaches Admin; repeated reports trigger CAPTCHA/limits;
   ignore removes the item from the queue; restore accepts a new report; buff
   removes a car from the next feed load. Verify posting/autosave and an
   invitation signup too. No real purchase is needed for these checks.

Firestore emulator tests do not model index availability, live App Check tokens,
real Google CAPTCHA configuration, service-account grants, or hosting domains.
These must be verified before calling the live release complete.

## Local checks

On 2026-10-29, Graph Bap, Admin and Functions built successfully; 18 backend/policy/
Firestore-emulator checks and seven focused Admin tests passed. A browser check
confirmed the report dialog, reason choices, cancellation, and mobile fit with
external network requests blocked. Builds still emit non-blocking size/CommonJS
warnings. The separate live verification is recorded under Current release above.

- Graph Bap: `npm run build`.
- Admin: `npm run build`; focused tests:
  `npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/graffiti-moderation/graffiti-moderation.spec.ts`.
- From Public, with Java and Firebase CLI available:
  `firebase emulators:exec --only firestore --project demo-graphbap "npm --prefix functions run test:graffiti"`.
  This builds functions and runs policy tests plus real named-database emulator
  transaction/rule tests. The integration suite refuses non-local emulator hosts.
  Running the functions test script without an emulator explicitly skips the
  integration suite and is not equivalent to this validation.
