import Link from 'next/link';

const TABS = [
  { href: '', label: 'Hours, services and calendar' },
  { href: '/staff', label: 'Staff' },
  { href: '/closures', label: 'Closures' },
  { href: '/answers', label: 'Answers' },
  { href: '/team', label: 'Team' },
  { href: '/../billing', label: 'Billing' },
];

/** Secondary navigation within Settings (also the way to reach Billing on phones). */
export function SettingsTabs({ slug, active }: { slug: string; active: string }) {
  return (
    <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-rule">
      {TABS.map((t) => {
        const href = t.href === '/../billing' ? `/app/${slug}/billing` : `/app/${slug}/settings${t.href}`;
        const on = t.href === active;
        return (
          <Link key={t.href} href={href} aria-current={on ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-[0.92rem] ${on ? 'border-action font-medium text-action-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
