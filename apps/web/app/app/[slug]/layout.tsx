import { Shell } from '@/components/shell';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const sb = await supabaseServer();
  const { count } = await sb.from('enquiries').select('id', { count: 'exact', head: true }).eq('organization_id', m.organizationId).eq('status', 'new');
  const base = `/app/${slug}`;
  const nav = [
    { href: base, label: 'Today' },
    { href: `${base}/calls`, label: 'Calls' },
    { href: `${base}/bookings`, label: 'Bookings' },
    { href: `${base}/messages`, label: 'Messages', badge: count ?? 0 },
    ...(m.role === 'owner' || m.role === 'manager' ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];
  return (
    <Shell context={m.name} nav={nav}>
      {m.status === 'onboarding' ? (
        <p className="mb-6 rounded-md border border-lamp-amber bg-lamp-amber-wash px-4 py-3 text-lamp-amber-ink">
          Your phone assistant isn’t answering calls yet. We’ll let you know when it’s live.
        </p>
      ) : null}
      {m.status === 'suspended' ? (
        <p className="mb-6 rounded-md border border-lamp-red bg-lamp-red-wash px-4 py-3">
          Your assistant is only taking messages because of a billing issue. Update your payment details to restore bookings.
        </p>
      ) : null}
      {children}
    </Shell>
  );
}
