import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMemberships, requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export default async function AppIndex() {
  const user = await requireUser();
  const memberships = await getMemberships();
  const sb = await supabaseServer();
  const { data: staff } = await sb.from('platform_staff').select('role').eq('user_id', user.id).maybeSingle();
  if (memberships.length === 1 && !staff) redirect(`/app/${memberships[0]!.slug}`);
  return (
    <main className="mx-auto max-w-[520px] px-4 py-12">
      <h1>Choose a business</h1>
      {memberships.length === 0 && !staff ? (
        <p className="mt-3 text-ink-soft">Your account isn’t linked to a business yet. Ask the business owner to invite you, or contact support.</p>
      ) : null}
      <ul className="sheet mt-6 divide-y divide-rule">
        {staff ? (
          <li>
            <Link className="block px-4 py-3 font-medium text-action-ink" href="/admin">Operator console</Link>
          </li>
        ) : null}
        {memberships.map((m) => (
          <li key={m.organizationId}>
            <Link className="block px-4 py-3 hover:bg-ground" href={`/app/${m.slug}`}>{m.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
