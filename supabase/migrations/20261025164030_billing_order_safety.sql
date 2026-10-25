-- Order-safe Stripe sync: ignore subscription events older than the last one applied.
alter table public.subscriptions add column if not exists last_stripe_event_at timestamptz;
