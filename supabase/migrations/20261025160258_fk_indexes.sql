-- Covering indexes for foreign keys (Supabase performance advisor 0001, 2026-10-25).
-- Composite (organization_id, x) FKs need an index on the referencing columns so deletes/cascades
-- and tenant-scoped joins don't scan whole tables.
create index if not exists agent_versions_org_agent_idx on public.agent_versions (organization_id, agent_id);
create index if not exists agent_versions_template_idx on public.agent_versions (template_id, template_version);
create index if not exists agents_org_active_version_idx on public.agents (organization_id, active_version_id);
create index if not exists appointment_events_org_appt_idx on public.appointment_events (organization_id, appointment_id);
create index if not exists appointments_org_call_idx on public.appointments (organization_id, call_id);
create index if not exists appointments_org_customer_idx on public.appointments (organization_id, customer_id);
create index if not exists appointments_org_location_idx on public.appointments (organization_id, location_id);
create index if not exists appointments_org_service_idx on public.appointments (organization_id, service_id);
create index if not exists appointments_org_staff_idx on public.appointments (organization_id, staff_id);
create index if not exists appointments_rescheduled_from_idx on public.appointments (rescheduled_from_id);
create index if not exists business_hours_org_loc_idx on public.business_hours (organization_id, location_id);
create index if not exists call_events_org_call_idx on public.call_events (organization_id, call_id);
create index if not exists call_recordings_org_call_idx on public.call_recordings (organization_id, call_id);
create index if not exists call_transcripts_org_call_idx on public.call_transcripts (organization_id, call_id);
create index if not exists calls_org_agent_version_idx on public.calls (organization_id, agent_version_id);
create index if not exists calls_org_customer_idx on public.calls (organization_id, customer_id);
create index if not exists calls_org_phone_number_idx on public.calls (organization_id, phone_number_id);
create index if not exists date_exceptions_org_loc_idx on public.date_exceptions (organization_id, location_id);
create index if not exists date_exceptions_org_staff_idx on public.date_exceptions (organization_id, staff_id);
create index if not exists enquiries_org_call_idx on public.enquiries (organization_id, call_id);
create index if not exists incidents_org_idx on public.incidents (organization_id);
create index if not exists jobs_org_idx on public.jobs (organization_id);
create index if not exists onboarding_tasks_org_idx on public.onboarding_tasks (organization_id);
create index if not exists phone_numbers_org_agent_idx on public.phone_numbers (organization_id, agent_id);
create index if not exists privacy_requests_org_idx on public.privacy_requests (organization_id);
create index if not exists service_staff_org_service_idx on public.service_staff (organization_id, service_id);
create index if not exists service_staff_org_staff_idx on public.service_staff (organization_id, staff_id);
create index if not exists staff_hours_org_staff_idx on public.staff_hours (organization_id, staff_id);
create index if not exists staff_members_org_calendar_idx on public.staff_members (organization_id, calendar_connection_id);
create index if not exists staff_members_org_location_idx on public.staff_members (organization_id, location_id);
create index if not exists subscriptions_plan_idx on public.subscriptions (plan_code);
