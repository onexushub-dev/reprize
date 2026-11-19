# Sharing: production setup (runbook)

Spec: `docs/superpowers/specs/2026-11-16-recording-sharing-design.md`. This is step 2 of the launch: everything the
production environment needs, done once. Secrets are typed in the terminal or in dashboards, never in the repository or
in a chat. Development (`reprize-dev`, ref `wkscydgikynfpfltpmht`) stays as it is.

## What reads what

| Part | Development | Production |
|---|---|---|
| App (`app.config.js`) | `app/.env.local` | EAS environment `production` (`eas env`) |
| Edge Functions | secrets of `reprize-dev` | secrets of the production project |
| pg_cron → `expire-shares` | Vault `project_url`, `cron_key` | the same names, production values |
| Site (`reprize-lp`) | nothing set: reads `reprize-dev` | Vercel env: `SHARE_API_*`, fallback `SHARE_FALLBACK_API_*` = dev |
| Universal Links | `reprizeapp.com/v/*`, both bundle ids in the AASA file | the same file |

## 1. Supabase project

1. Create the project (`reprize`, region São Paulo `sa-east-1`, the same as dev). Note its ref and publishable key.
2. Migrations, from `Lance/supabase`:
   ```
   npx supabase link --project-ref <prod ref>
   npx supabase db push --remote
   npx supabase migration list --remote          # every migration in both columns
   npx supabase link --project-ref wkscydgikynfpfltpmht   # back to dev
   ```
3. Auth → Providers (copy the settings of `reprize-dev`):
   - Apple: on; Client IDs `app.reprize.mobile` (add `app.reprize.develop` while the field test runs a develop build
     against production).
   - Google: on; the Web client id and secret; the iOS client ids of both bundle ids in the allowed client ids; skip
     nonce checks on (native iOS sign-in).
   - Email sign-up: off (the app signs in only with Apple and Google).

## 2. Cloudflare R2

1. Bucket `reprize-shares` (production), location near Brazil if offered.
2. Lifecycle rule: delete objects 2 days after upload (the safety net if `expire-shares` stops).
3. CORS: allow `GET` and `HEAD` from `https://reprizeapp.com` and `https://www.reprizeapp.com` (the link page's cover).
4. An API token with Object Read & Write on this bucket only.

## 3. Function secrets

Write them in a file outside the repository, set them, then delete the file:

```
# ~/reprize-prod.env (outside Lance, deleted afterwards)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=reprize-shares
REVENUECAT_SECRET_KEY=...          # RevenueCat v2 secret key of the app's project (entitlement "pro")
CRON_KEY=...                       # openssl rand -hex 24; the same value goes in Vault (step 4)
APPLE_TEAM_ID=R885ZD42ZG
APPLE_KEY_ID=...                   # the Sign in with Apple key (.p8) used for revocation
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APPLE_CLIENT_IDS=app.reprize.mobile
```

```
cd Lance/supabase
npx supabase secrets set --env-file ~/reprize-prod.env --project-ref <prod ref>
rm ~/reprize-prod.env
```

Never in production: `PRO_CHECK`, `DEV_RESET`, `RESET_KEY`, `SPIKE_KEY`.

## 4. Vault (the cleanup schedule)

In the production SQL Editor, with the same `CRON_KEY` as step 3:

```sql
select vault.create_secret('https://<prod ref>.supabase.co', 'project_url');
select vault.create_secret('<CRON_KEY>', 'cron_key');
```

The schedule itself comes with the first migration (`cron.schedule`, every 10 minutes).

## 5. Functions

```
npx supabase functions deploy create-share confirm-upload share-off share-page open-share report-share \
  expire-shares delete-account --project-ref <prod ref>
```

Not in production: `spike-sign`, `dev-reset`.

## 6. Site (Vercel, project reprize-lp)

Environment variables, Production only:

```
SHARE_API_BASE=https://<prod ref>.supabase.co/functions/v1
SHARE_API_KEY=<prod publishable key>
SHARE_FALLBACK_API_BASE=https://wkscydgikynfpfltpmht.supabase.co/functions/v1
SHARE_FALLBACK_API_KEY=<dev publishable key>
```

Preview deployments keep nothing set (they read dev). Redeploy after setting them.

## 7. App build

EAS environment `production`:

```
eas env:create --environment production --name REPRIZE_SUPABASE_URL --value https://<prod ref>.supabase.co --visibility plaintext
eas env:create --environment production --name REPRIZE_SUPABASE_KEY --value <prod publishable key> --visibility plaintext
eas env:create --environment production --name REPRIZE_GOOGLE_IOS_CLIENT_ID --value <iOS client of app.reprize.mobile> --visibility plaintext
eas env:create --environment production --name REPRIZE_GOOGLE_WEB_CLIENT_ID --value <Web client> --visibility plaintext
```

Field test before launch: a local Release build (`npx expo run:ios --configuration Release --device`) with
`app/.env.local` pointing to production (`REPRIZE_SUPABASE_URL`, `REPRIZE_SUPABASE_KEY`) and diagnostics on. Put the
dev values back afterwards.

## 8. Checks

1. Share a recording: the link opens on `reprizeapp.com` (production project) and in the app.
2. A link made with a dev build still opens on `reprizeapp.com` (fallback).
3. Turn a link off: within 10 minutes its folder leaves the production bucket (`expire-shares` runs).
4. Courtesy, report and review (`supabase/scripts/reports.sql`) on production.
5. Delete an Apple account: `delete-account` answers `appleRevoked: true`, and Reprize leaves the Apple ID's
   "Sign in with Apple" list.
