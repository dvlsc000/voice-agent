'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

/**
 * App frame: left rail on wide screens, bottom bar on phones (owners mostly check this between customers).
 */
export function Shell({ context, nav, children }: { context: string; nav: NavItem[]; children: React.ReactNode }) {
  const path = usePathname();
  // Longest matching prefix wins, so /app/x/calls/123 highlights "Calls".
  const active = [...nav].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(`${n.href}/`))?.href;
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Reception';
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden border-r border-rule bg-surface md:block">
        <div className="sticky top-0 flex h-dvh flex-col px-4 py-5">
          <p className="text-[0.8rem] text-ink-faint">{brand}</p>
          <p className="mt-0.5 font-semibold leading-tight">{context}</p>
          <nav aria-label="Main" className="mt-6 grid gap-0.5">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active === n.href ? 'page' : undefined}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${active === n.href ? 'bg-action-wash font-medium text-action-ink' : 'text-ink-soft hover:bg-ground hover:text-ink'}`}
              >
                {n.label}
                {n.badge ? <span className="tnum rounded-full bg-lamp-amber px-1.5 text-[0.75rem] font-semibold text-ink">{n.badge}</span> : null}
              </Link>
            ))}
          </nav>
          <form action="/auth/signout" method="post" className="mt-auto">
            <button className="text-[0.85rem] text-ink-faint hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1080px] px-4 pb-24 pt-6 md:px-8 md:pb-10 md:pt-8">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-rule bg-surface md:hidden">
        {nav.slice(0, 5).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active === n.href ? 'page' : undefined}
            className={`relative flex-1 py-3 text-center text-[0.8rem] ${active === n.href ? 'font-semibold text-action-ink' : 'text-ink-soft'}`}
          >
            {n.label}
            {n.badge ? <span aria-label={`${n.badge} new`} className="absolute right-[22%] top-2 h-2 w-2 rounded-full bg-lamp-amber" /> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
