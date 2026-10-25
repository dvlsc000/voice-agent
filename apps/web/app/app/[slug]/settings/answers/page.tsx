import { Lamp } from '@/components/lamp';
import { Empty, PageHeader } from '@/components/page-header';
import { SettingsTabs } from '@/components/settings-tabs';
import { requireMembership } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { addAnswer, setAnswerStatus } from './actions';

export const metadata = { title: 'Answers' };

export default async function AnswersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, ['owner', 'manager']);
  const sb = await supabaseServer();
  const { data } = await sb.from('knowledge_items').select('id, question, content, language, status, source').eq('organization_id', m.organizationId).neq('status', 'archived').order('created_at');
  const set = setAnswerStatus.bind(null, slug);
  return (
    <>
      <PageHeader title="Settings" detail="Answers to questions callers often ask: parking, payment, cancellations, what to bring. Your assistant uses approved answers only, word for word in meaning." />
      <SettingsTabs slug={slug} active="/answers" />
      <form action={addAnswer.bind(null, slug)} className="sheet mb-6 grid gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <label className="field"><span>Question callers ask</span><input className="input" name="question" required maxLength={300} placeholder="Is there parking nearby?" /></label>
          <label className="field">
            <span>Language</span>
            <select className="input" name="language" defaultValue={m.primaryLanguage}><option value="en">English</option><option value="hr">Croatian</option></select>
          </label>
        </div>
        <label className="field"><span>Answer</span><textarea className="input min-h-[80px]" name="content" required maxLength={4000} placeholder="Yes, free parking behind the shop on Quay Street." /></label>
        <div><button className="btn btn-primary">Add answer</button></div>
      </form>
      <div className="sheet">
        {!data?.length ? <Empty title="No answers yet.">Add the questions you hear most often on the phone.</Empty> : (
          <ul className="divide-y divide-rule">
            {data.map((k: any) => (
              <li key={k.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
                <div className="max-w-[70ch]">
                  <p className="font-medium">{k.question ?? 'Note'} <span className="text-[0.8rem] font-normal text-ink-faint">{k.language === 'hr' ? 'Croatian' : 'English'}{k.source === 'website_import' ? ' · from your website' : ''}</span></p>
                  <p className="text-ink-soft">{k.content}</p>
                </div>
                <div className="flex items-start gap-2">
                  {k.status === 'approved' ? <Lamp tone="green">In use</Lamp> : (
                    <form action={set}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="status" value="approved" /><button className="btn btn-quiet">Approve</button></form>
                  )}
                  <form action={set}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="status" value="archived" /><button className="btn btn-quiet">Remove</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
