import { Shell } from '@/components/shell';
import { requirePlatformStaff } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformStaff();
  return (
    <Shell
      context="Operator console"
      nav={[
        { href: '/admin', label: 'Overview' },
        { href: '/admin/clients', label: 'Clients' },
        { href: '/admin/plans', label: 'Plans' },
      ]}
    >
      {children}
    </Shell>
  );
}
