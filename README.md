# Buyer Strategy Assistant

An interactive web app for Australian buyer agents. It turns buyer conversations into a confirmed buyer profile, models purchase scenarios with a deterministic finance engine, compares areas against dated evidence, and produces reviewed, versioned PDF reports.

The build follows `Buyer_Agent_AI_Build_Specification_2495.pdf` (v1.1, 1 October 2026). The screen plan written before coding is in [`docs/screen-plan.md`](docs/screen-plan.md).

> **Status: working prototype, deployed.** Milestones 1–3 work end to end at **https://buyer-strategy-assistant.vercel.app**. See [Delivery summary](#delivery-summary) for exactly what is done, what was tested, and what still needs external credentials. All seed data is fictional and labelled in the UI. Demo login details are shared separately, never in this repository.

---

## Quick start (local)

Requires Node 20+. No database install is needed: locally the app uses **PGlite**, a real PostgreSQL engine embedded in Node and stored in `./.data/pglite`.

```bash
npm install
npm run db:reset      # migrate + create fictional seed data
npm run dev           # http://localhost:3000
```

Demo accounts are documented in [`src/lib/db/seed.ts`](src/lib/db/seed.ts): an administrator, a buyer agent, a reviewer, and an agent in a second organisation for isolation testing. They share one development password, which you can override with `SEED_PASSWORD`.

PGlite allows **one process at a time**, so stop `npm run dev` before running `npm run db:*` scripts.

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm test` | Unit tests: finance engine and numerical fixture, extraction, interview engine (Vitest) |
| `npm run test:api` | HTTP acceptance checks against a running server (`BASE_URL`, default `http://localhost:3000`). Run after `db:reset` |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run db:generate` | Generate a SQL migration from `src/lib/db/schema.ts` (drizzle-kit) |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations / seed if empty / wipe the local DB and reseed |

## Environment variables

Names only are listed in [`.env.example`](.env.example). No secrets are committed.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Production | PostgreSQL (e.g. Neon via the Vercel Marketplace). Unset locally → PGlite. |
| `SESSION_SECRET` | Production | 32+ random characters; signs the HTTP-only session cookie. |
| `SEED_PASSWORD` | To seed production | Password for the fictional demo accounts. |
| `ANTHROPIC_API_KEY` | Optional | Turns on AI extraction and report drafting. Without it the rule-based extractor and template narrative are used. |
| `AI_MODEL`, `AI_EFFORT`, `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_MAX_INPUT_CHARS` | Optional | Defaults: `claude-opus-5-5`, `medium`, 45 s, 8 000, 40 000 chars. |
| `MARKET_PROVIDER`, `MARKET_PROVIDER_API_KEY` | Future | Reserved for a licensed provider adapter. |
| `ALLOW_EPHEMERAL_DB`, `AUTO_SEED` | Demo only | Runs production on a throwaway PGlite in `/tmp`; data is lost on cold start. |

## Deploying to Vercel

1. Create a Postgres database (Vercel Marketplace → Neon) and set `DATABASE_URL`, `SESSION_SECRET` and `SEED_PASSWORD` in the Vercel project.
2. Run migrations and the seed once against that database, from a machine with `DATABASE_URL` set:
   ```bash
   npm run db:seed
   ```
   (`db:seed` runs migrations first and only seeds an empty database.)
3. Deploy (`vercel --prod`, or connect the Git repository). Build command `next build`; the default framework settings work.
4. Optionally add `ANTHROPIC_API_KEY` and redeploy.

Functions run in Sydney (`syd1`, set in [`vercel.json`](vercel.json)) next to the Neon database in `ap-southeast-2`. Keep the two in the same region: each page runs many sequential queries, so a cross-region hop multiplies page load time.

Background jobs (note extraction, PDF export) run in-process after the response via Next.js `after()`, which Vercel supports through `waitUntil`. No separate worker is required at this scale.

---

## Architecture

```
src/
  app/                    Next.js 16 App Router — pages and /api route handlers (Section 12)
  components/workspace/   Assessment workspace: Interview, Profile, Scenario lab (Scenarios + Suburbs research), Report, Activity tabs
  lib/
    finance/      Pure decimal finance engine: funding, LVR, loan schedules, rent/cashflow, ceiling, patches, comparisons
    profile/      Field registry (Section 6) and profile derivation from facts (conflicts, proposals)
    interview/    Typed question registry, safe predicate engine, question selection, readiness
    extract/      Rule-based extractor + server-side validation for any extractor (rules or AI)
    ai/           Claude adapter: structured outputs, schema validation, one retry, refusal fallback
    market/       PropertyDataProvider interface, metric catalogue, freshness, explainable fit
    scenario/     Profile → explicit calculation inputs, each labelled confirmed / assumed / missing
    reports/      Snapshot builder, controlled narrative validator, PDF renderer
    services/     Use-cases: assessments, profile (revisions, 409s), scenarios, reports, market, jobs, exports
    access/       Organisation + case permission checks used by every handler
    db/           Drizzle schema, migrations (./drizzle), fictional seed
```

**Core rules the code enforces:**

- **AI only proposes.**
  - Extraction produces *proposed* facts, each with the exact supporting quote. The server rejects unknown field paths, invalid values, and evidence quotes that don't appear in the source.
  - Nothing financial is confirmed without a person, and confirmations record who confirmed them and when.
  - Pasted text is treated as data. Injected instructions have no effect (AT15).
- **Conflicts are preserved.** Two different confirmed values for one field leave the field unusable until a person picks one or supplies the correct value (INT04, AT02).
- **Unknown is not zero.**
  - Every value is either a value (including explicit 0), unknown, not applicable, or declined.
  - Missing inputs return `incomplete` with the missing field list.
- **Deterministic arithmetic.**
  - All money is integer cents, and calculations run in `decimal.js` at full precision, rounding only at the specified boundaries.
  - Each result stores `calculationVersion` and an input hash.
- **Immutability and versions.**
  - Scenarios are immutable. What-ifs create new scenarios from a parent plus a recorded change list.
  - Profile edits bump a revision with optimistic concurrency (stale writes get 409).
  - Reports snapshot everything they show. A reviewed report is frozen, and a new report supersedes it without altering it.
- **Dependency tracking.** Each revision records its changed field paths. A scenario is *stale* when finance, funds, properties, household or purpose inputs change after it was calculated. Stale scenarios cannot enter a new report.
- **Controlled narrative.**
  - Report prose may only show figures through `{{ref}}` placeholders bound to saved values.
  - Any digit outside a placeholder fails validation, and AI narrative that fails falls back to the deterministic template.
- **Isolation.**
  - The organisation always comes from the authenticated membership.
  - Records in another organisation return 404, never 403, so their existence isn't revealed.
  - Every route handler checks access. The proxy redirect is a convenience only.

### Calculation conventions (Section 9)

```
current_equity      = property_value − secured_debt            (can be negative)
theoretical_headroom= max(0, valuation × LVR_cap − secured_debt) (not an approved limit)
usable_cash         = committed_cash − protected_reserve − earmarked
available_funding   = usable_cash + eligible_net_sale_proceeds + equity_draw_allocated
cash_required       = price + upfront_costs − purchase_loan
scheduled_rent      = weekly × 52;  collected = weekly × (52 − vacant_weeks)
NOI                 = collected − operating_costs
yields              = scheduled (gross) or NOI (net) ÷ price   (zero price → not applicable)
debt_service        = first 12 scheduled payments of the purchase loan + the FULL equity draw
average_monthly     = annual cashflow ÷ 12 (labelled as an average)
```

- Each funding source can be consumed only once; two sources linked to the same account are rejected.
- Superannuation and "loan proceeds as cash" are excluded and flagged.
- Sale proceeds must be net and available before settlement, otherwise funding is marked *conditional*.
- The funding ceiling scans an explicit price grid. It returns the highest feasible price (rounded down), the binding constraint and all assumptions, or `incomplete` / `no_feasible_scenario`. It is never labelled an approved budget.
- Loan schedules:
  - P&I uses the annuity formula, with `r = 0` amortising evenly.
  - Interest-only months pay interest only, then the balance amortises over the remaining term.
  - Rate changes re-amortise from their declared month.
  - The final payment reconciles to a zero balance.

### Market data

`PropertyDataProvider` (`src/lib/market/provider.ts`) defines area resolution, area statistics, rental estimates and comparables, with structured `unavailable / stale / access_denied / provider_failure / not_configured` results.

- **No live provider is connected.** The spec's "REI" must be pinned to an exact product and licence first. Until then, lookups return `not_configured` and never pretend a search happened.
- **Manual evidence** needs a value, unit, source and date. Each metric has a freshness threshold; with none configured, only the age is shown.
- **Seed evidence** is labelled `SAMPLE DEVELOPMENT DATA` everywhere, including PDFs.

To add a provider, implement the interface and register it in `getProvider()` behind `MARKET_PROVIDER`.

---

## Acceptance checklist (AT01–AT18)

| ID | Where it is verified | Result |
|---|---|---|
| AT01 periods kept; "8k" asks a follow-up | `src/lib/extract/extract.test.ts`; also in the browser (weekly income / monthly expenses) | ✅ Pass |
| AT02 conflicting confirmed balances stay unresolved | `scripts/acceptance-api.ts`; browser (seed case "Jordan") | ✅ Pass |
| AT03 confirmed facts suppress questions; purpose change recalculates | `src/lib/interview/engine.test.ts`, `acceptance-api.ts` | ✅ Pass |
| AT04 save/resume; repeated request does not duplicate a turn | `acceptance-api.ts` (idempotency key) | ✅ Pass |
| AT05 PPOR prioritises household fit; no rental income | `finance.test.ts`, `engine.test.ts`, `acceptance-api.ts` | ✅ Pass |
| AT06 percentage points vs relative percent | `finance.test.ts` (a bare "%" asks for clarification) | ✅ Pass |
| AT07 scenario change → new version; base and reviewed report unchanged | `finance.test.ts`, `acceptance-api.ts` | ✅ Pass |
| AT08 fixture to within A$0.01; yields at stated precision | `finance.test.ts` (base + downside); `acceptance-api.ts` via the API | ✅ Pass |
| AT09 equity loan included; unallocated draw still costs interest | `finance.test.ts` | ✅ Pass |
| AT10 super / offset / loan proceeds not double counted | `finance.test.ts`, `engine.test.ts` | ✅ Pass |
| AT11 unknown scope blocks ceiling; insufficient funds → no feasible scenario | `finance.test.ts`, `acceptance-api.ts` | ✅ Pass |
| AT12 zero-rate, reconciliation, interest-only expiry | `finance.test.ts` | ✅ Pass |
| AT13 missing rent/rates/costs → incomplete; zero price → no infinite yield | `finance.test.ts` | ✅ Pass |
| AT14 stale/unavailable provider data labelled, never fabricated | `acceptance-api.ts` (sample labelling); provider returns `not_configured` | ✅ Pass (no live provider exists to test against) |
| AT15 injected instructions cannot change permissions or expose cases | `acceptance-api.ts`; browser check with injected notes | ✅ Pass |
| AT16 cross-org reads/writes/jobs/exports fail; stale edits → 409 | `acceptance-api.ts` | ✅ Pass |
| AT17 report numbers and evidence IDs match the snapshot, incl. export retry | `acceptance-api.ts` (hash check, idempotent export) | ✅ Pass |
| AT18 keyboard-only interview; nothing depends on colour | Semantic controls, visible focus, text status labels, roving-tab keyboard support, focus moves to the next question | ⚠️ Built in, but no full keyboard-only or screen-reader pass done |

Latest run: **60/60 unit tests** and **31/31 HTTP acceptance checks**, against both `next dev` and the production build (`next start`), plus lint and a production build. The full journey was also tested by hand on the live deployment.

---

## Delivery summary

**Complete, deployed and tested on the live site:**
- **Login, cases and audit:** organisation login and case dashboard (search, readiness, unresolved items, report status), case assignment and audit history.
- **Intake:** pasted notes with extraction and source quotes; a guided interview that branches by purpose. It has Back/Edit answer, Not sure, Prefer not to say, Skip (gap kept visible) and Save and continue later.
- **Facts and live profile:** conflict resolution, bulk confirmation, and a live summary with readiness per output. The full buyer profile shows source, confirmer and history for each field.
- **Finance and scenarios:** the finance engine reproduces the spec fixture exactly. The scenario lab has what-if controls, natural-language what-ifs (proposed, then run), a downside case, comparisons with explained deltas, a funding ceiling, and stale detection.
- **Research:** area comparison with dated manual evidence and an explainable Meets / Partly meets / Does not meet / Unknown fit per criterion, plus goal-conflict detection.
- **Reports:** drafts, agent commentary, chosen next actions, a submit → review → approve / request changes workflow, version history, and an idempotent PDF export verified against the frozen snapshot.
- **Administration:** users and permissions, branding, retention setting, evidence freshness, provider status, interview registry, and health metrics.

**Needs credentials or decisions from you (not done):**
- **AI:** the Claude extraction and report drafting are implemented and schema-validated, but **not yet exercised against the live API** because no `ANTHROPIC_API_KEY` was available. The deterministic path is what was tested.
- **Market data provider:** the adapter interface and manual workflow are complete. The "REI" product must be identified and licensed before a live adapter is written.

**Known limitations of this prototype:**
- Retention days are stored, but no automated deletion job exists yet.
- Login throttling is per server instance.
- There is no in-app password change. Admins set temporary passwords.
- PDFs are regenerated from the frozen snapshot on each download instead of being stored in object storage.
- Jobs run in-process via `after()` with bounded retries, not on a separate queue.
- The data model stores households, existing properties, loans and funding sources as versioned profile facts instead of the separate tables listed in spec Section 11. This works for one buying household per case; multi-household or CRM use would need those tables.
- The scenario API supports an upside case, but the UI only creates base, downside and alternative cases.
- AI calls have input-size and output-token caps, but no per-assessment cost limit yet. The admin health page shows tokens, not cost per assessment.
- Research is a "Suburbs" view inside the Scenario lab rather than its own tab.
- AT18 (keyboard-only completion) still needs a full manual pass.
- P1/P2 items are not started: document import, buyer self-service, audio, OCR, CRM, a second provider, and multilingual reports.
