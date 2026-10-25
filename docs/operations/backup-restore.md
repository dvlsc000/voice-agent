# Backups and restore

## What exists
- Supabase takes **daily backups** on paid plans; **point-in-time recovery** is an add-on. Check the plan of the production
  project before launch — the free tier is not adequate for customer data. (External action; costs money.)
- Supabase Vault secrets (calendar tokens) are inside the database and covered by the same backups.
- Call audio is not stored by default (recording is off).

## Restore drill (do this before launch, then quarterly)
1. Create a scratch Supabase project (or a branch) in the same region.
2. Restore the latest backup into it (Supabase dashboard → Database → Backups → Restore to new project).
3. Point a local web app at it and check: sign-in works, a client's calls/bookings/messages are present, row counts of
   `organizations`, `appointments`, `calls` match production within the backup window.
4. Run the isolation check from `docs/adr/0003-tenancy-security.md` against the restored copy.
5. Record the date, duration and any problems in `docs/STATUS.md`. Delete the scratch project.

**Status: not yet done.** The development project has no customer data and no paid backups.

## Targets (proposed)
- RPO (data you can afford to lose): 5 minutes with point-in-time recovery; 24 hours with daily backups only.
- RTO (time to restore service): 2 hours. Calls keep reaching businesses during a database outage only via the
  Twilio-level fallback described in `incident-response.md`.
