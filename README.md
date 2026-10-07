# DSA Squad

A private accountability app for a group of friends working through DSA together: **2 questions Monday-Friday, 1 Saturday, and Sunday off**, in roadmap order, from the *NeetCode 150 + Striver Master DSA Patterns* reference (269 deduplicated questions). Each person records *how they solved it*, revises on a schedule, and friends get notified (and can nudge) when someone is behind. No leaderboards, no bonus questions.

## Features
- Auth: register, login, logout, profile edit, change password (signs out other devices), delete account. bcrypt hashing, JWT.
- 269 questions seeded from the PDF with topics, `[N]`/`[S]` source badges, and the **real URLs extracted from the PDF's links** (LeetCode, NeetCode, Striver, YouTube). Nothing invented.
- Daily engine: persisted assignments in roadmap order (2 on weekdays, 1 Saturday, none Sunday), never repeated within a study scope (enforced by DB constraints + locking).
- Five per-user statuses: Not started, Attempted, Solved, Needs revision, Revised.
- "How I solved it" (approach, code, complexity, mistakes, learnings), private by default, optionally shared per group with per-field control; "Stop sharing".
- Official reference approaches are rendered from `solution_approaches` only after an explicit, meaningful self-reported submission. Draft write-ups never unlock them.
- Revisions: configurable schedule (default 1, 3, 7, 21 days), "Revision due today".
- Dashboard (today, solved, attempted, remaining, streaks, revisions, topic progress) and group dashboard (counts only).
- Notifications: 6 types, bell with unread count, preferences that really gate behaviour, rate-limited nudges, DB-backed idempotent scheduler.
- Search + filters (topic, source, status, solved, revision due).

## Architecture
```
React (Vite) --HTTPS--> Express API --pg--> PostgreSQL (Supabase)
   Vercel                  Render
GitHub Actions (hourly) --POST /api/jobs/notifications--> Express
```
The browser only talks to the API. The database URL never reaches the frontend.

Stack: React 18, React Router, Tailwind; Node 18+, Express, zod, pg, bcryptjs, jsonwebtoken, helmet, express-rate-limit; PostgreSQL 14+; Vitest + Supertest (tests run against a real PostgreSQL).

```
backend/src/{config,controllers,routes,services,middleware,validators,models,jobs,utils}
backend/scripts/{migrate,seed,test-setup}.js     backend/tests/
frontend/src/{components,pages,hooks,services,context,utils}
database/{migrations,seeds,schema.sql}
```

## Local setup
Requirements: Node 18+, PostgreSQL (local, Docker, or Supabase).

```bash
# 1. database (pick one)
createdb dsa_squad && createdb dsa_squad_test          # local Postgres
# or: docker compose up db                             # Postgres on :5432 (user/pass/db: dsa/dsa/dsa_squad)

# 2. backend
cp .env.example backend/.env       # then edit DATABASE_URL and set JWT_SECRET
cd backend
npm install
npm run migrate
npm run seed                       # 269 questions (safe to re-run)
npm run dev                        # http://localhost:5000/api/health

# 3. frontend (new terminal)
cd frontend
npm install
cp .env.example .env               # VITE_API_URL=http://localhost:5000
npm run dev                        # http://localhost:5173
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Tests
```bash
cd backend
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/dsa_squad_test   # name must contain "test"; it is wiped
npm test
```
68 tests cover auth, the 269-question bank and filters, Solo/Squad study state and migration rules, daily assignments and concurrency, progress/streaks/pause boundaries, private solutions and sharing, group authorization, revisions, notification detection and idempotency, preferences, nudges and rate limits, cron auth, CORS and error format.

### Docker (local dev only)
`docker compose up` starts Postgres, the API (migrates + seeds) and the Vite dev server. Production uses Vercel + Render + Supabase.

## Environment variables
See `.env.example` (every variable is used). Backend: `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `APP_TIMEZONE`, `REVISION_INTERVALS_DAYS`, `CRON_SECRET`, `REMINDER_HOUR`, `SUMMARY_HOUR`, `NUDGE_COOLDOWN_MINUTES`, `NUDGE_DAILY_LIMIT`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `PORT`, `NODE_ENV`. Frontend: only `VITE_API_URL`. Web Push is not implemented, so there are no push keys.

## Deployment (GitHub -> Supabase -> Render -> Vercel)

**STEP 1: Push to GitHub.** `git init && git add . && git commit -m "DSA Squad" && git remote add origin <url> && git push -u origin main`. `.env` files are git-ignored; verify with `git status` before pushing.

**STEP 2: Create the Supabase project.** supabase.com -> New project, choose a region near you and set a database password (save it). Then **Connect** -> copy the **Session pooler** connection string (works over IPv4, which Render needs; the "direct" string may be IPv6-only). Replace `[YOUR-PASSWORD]`; URL-encode special characters in the password (`@` -> `%40`).

**STEP 3: Run migrations** from your machine:
```bash
cd backend && npm install
DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' JWT_SECRET=x npm run validate:study-state-migration
DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' NODE_ENV=production JWT_SECRET='replace-with-a-random-secret-of-at-least-32-characters' ALLOW_PRODUCTION_MIGRATIONS=true npm run migrate
```
(For an existing database, review a `ready_to_migrate: true` preflight before running migrations. For a brand-new empty database, the preflight has no legacy tables to inspect, so run the explicit migration command directly.) Migrations 002 and 005 enable Row Level Security on their tables and revoke Data API access from `anon`/`authenticated`; the Express backend connects as the database owner and is unaffected. Use the migration runner so the schema migration records stay in sync.

**STEP 4: Seed the 269 questions:** same command with `npm run seed` instead. Expected: `Seeded 269 questions across 17 topics, 26 approaches.`

**STEP 5: Create the Render service.** New -> Blueprint (reads `render.yaml`) or New Web Service with root directory `backend`, build `npm ci --omit=dev`, start `npm start`, health check `/api/health`. Migrations are an explicit operations step: run the read-only study-state preflight against the target database first; only after reviewing its report, run `NODE_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true npm run migrate` from `backend`.

**STEP 6: Render environment variables:** `NODE_ENV=production`, `DATABASE_URL` (Supabase string), `JWT_SECRET` (>= 32 chars), `CRON_SECRET` (random), `FRONTEND_URL` (temporary placeholder), `APP_TIMEZONE`.

**STEP 7: Deploy the backend.**

**STEP 8: Verify** `https://<service>.onrender.com/api/health` returns `{"success":true,"status":"healthy"}`.

**STEP 9: Create the Vercel project.** Import the repo, set **Root Directory = `frontend`** (framework Vite; `vercel.json` adds the SPA rewrite).

**STEP 10: Set `VITE_API_URL`** to the Render URL (no trailing slash) in Vercel -> Environment Variables.

**STEP 11: Deploy the frontend.**

**STEP 12: Update `FRONTEND_URL`** on Render to the exact Vercel origin (e.g. `https://dsa-squad.vercel.app`, no trailing slash; comma-separate to allow preview URLs too) and redeploy. CORS only allows listed origins.

**STEP 13: Test:** register, open *Today's two*, mark one solved, save a write-up, create a group, join from a second account, nudge, check the bell.

### Notifications in production
The scheduler is a plain function over database state (`processScheduled`) guarded by unique `dedupe_key`s, so running it any number of times, late, or after a restart never duplicates anything. Trigger it from outside:
- **GitHub Actions (included):** `.github/workflows/notifications-cron.yml` calls `POST /api/jobs/notifications` hourly with header `x-cron-secret`. Add repo secrets `BACKEND_URL` and `CRON_SECRET` (same value as Render). The retries also wake a sleeping Render service.
- Or any cron service (cron-job.org, Render cron job running `npm run job:notifications`, etc.).

Behaviour: from `REMINDER_HOUR` (default 18:00 in `APP_TIMEZONE`) people who are behind get a personal reminder and their friends get "pending" notices; from `SUMMARY_HOUR` (21:00) a group summary is sent; due revisions are announced; "friend completed" notices are sent instantly when someone finishes. Email via Resend is optional (`EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`); without it, in-app notifications work fully.

### Free-tier limits (check current terms; they change)
Render free web services sleep after inactivity, so the first request can take about a minute. Supabase free projects pause after a period of inactivity and have storage/connection limits. GitHub scheduled workflows can be delayed and are disabled on repos with no activity for a long period. Vercel hobby plans are for non-commercial use. None of these are unlimited.

## API
All responses: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`. Auth: `Authorization: Bearer <token>` (also an httpOnly cookie).

| Area | Endpoints |
|---|---|
| Health | `GET /api/health` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Users | `GET/PATCH /api/users/me`, `POST /api/users/me/password`, `DELETE /api/users/me`, `POST /api/users/:userId/nudge` |
| Groups | `POST/GET /api/groups`, `GET /api/groups/:id`, `GET /api/groups/:id/progress`, `POST /api/groups/join`, `POST /api/groups/:id/members`, `POST /api/groups/:id/invites`, `DELETE /api/groups/:id/members/:userId`, `GET /api/groups/:id/questions/:qid/shared` |
| Questions | `GET /api/questions` (`q, topic, source, status, solved, revisionDue`), `GET /api/topics`, `GET /api/questions/:id`, `GET /api/questions/:id/approaches` (requires a submission) |
| Solutions | `GET/PUT /api/questions/:id/my-solution` (private drafts), `POST /api/questions/:id/submissions` (unlocks official approaches), `PUT /api/questions/:id/share`, `DELETE /api/questions/:id/share/:groupId` |
| Daily | `GET /api/daily`, `GET /api/daily/:date` |
| Progress | `GET /api/progress`, `GET /api/progress/topic/:topic`, `PATCH /api/progress/:questionId` |
| Revisions | `GET /api/revisions/due`, `POST /api/revisions/:questionId/complete` |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `GET/PATCH /api/notification-preferences` |
| Cron | `POST /api/jobs/notifications` (header `x-cron-secret`) |

## Troubleshooting
- **`Missing required environment variables`**: set `DATABASE_URL` and `JWT_SECRET`.
- **CORS error in the browser**: `FRONTEND_URL` must exactly equal the page origin (scheme + host, no trailing slash).
- **Supabase `ENETUNREACH` / timeout on Render**: you used the direct (IPv6) string; use the Session pooler string.
- **`password authentication failed`**: URL-encode special characters in the password.
- **Tests refuse to run**: `TEST_DATABASE_URL` must be set and its database name must contain "test".
- **First request is slow in production**: Render free tier waking up.
- **Production login works but you get logged out**: ensure `VITE_API_URL` points to the backend and the build was redeployed after changing it.

## Source data notes
`database/seeds/questions.json` was generated from the PDF (titles, topics, badges, notes, and link annotations). The PDF's header says 179 Striver entries, but the document lists **178** (150 NeetCode + 178 Striver - 59 shared = 269, which matches the 269 total). Difficulty and problem statements are not in the PDF, so they are `null` and the UI says so. `database/seeds/approaches.json` holds educational approaches **written for this app** (not from the PDF) for 12 questions; the UI labels them as such.
