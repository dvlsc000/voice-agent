import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';

export default async function Home() {
  redirect((await getUser()) ? '/app' : '/login');
}
