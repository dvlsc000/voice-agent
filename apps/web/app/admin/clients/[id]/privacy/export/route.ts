import { NextResponse, type NextRequest } from 'next/server';
import { exportSubjectData, normaliseSubject } from '@vp/server';
import { requirePlatformStaff } from '@/lib/auth';
import { serverDb } from '@/lib/db';

/** Data-subject access export (JSON download). Every export is written to the audit log. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformStaff();
  const { id } = await params;
  const db = serverDb();
  const org = (await db.query(`select country from public.organizations where id = $1`, [id])).rows[0];
  if (!org) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let subject;
  try {
    subject = normaliseSubject({ phone: request.nextUrl.searchParams.get('phone'), email: request.nextUrl.searchParams.get('email') }, org.country);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const data = await exportSubjectData(db, id, subject);
  await db.query(
    `insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, target_table, target_id, new_data) values ($1, $2, 'user', 'export', 'privacy_requests', null, $3)`,
    [id, staff.userId, JSON.stringify({ kind: 'access_export' })],
  );
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="data-export-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' },
  });
}
