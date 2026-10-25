import { randomUUID } from 'node:crypto';
import { PageHeader } from '@/components/page-header';
import { requirePlatformStaff } from '@/lib/auth';
import { NewClientForm } from './new-client-form';

export const metadata = { title: 'Create client' };

export default async function NewClientPage() {
  await requirePlatformStaff();
  return (
    <>
      <PageHeader
        title="Create client"
        detail="Sets up the business from its industry template. Nothing goes live until a phone number is connected, tests pass and you publish the assistant."
      />
      <NewClientForm idempotencyKey={randomUUID()} />
    </>
  );
}
