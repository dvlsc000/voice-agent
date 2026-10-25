'use client';
import { useActionState } from 'react';
import { createClientAction, type CreateState } from './actions';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-[14rem_1fr]">
      <legend className="contents">
        <span className="font-semibold">{title}{hint ? <span className="mt-1 block text-[0.85rem] font-normal text-ink-soft">{hint}</span> : null}</span>
      </legend>
      <div className="grid gap-4">{children}</div>
    </fieldset>
  );
}

export function NewClientForm({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createClientAction, {});
  return (
    <form action={action} className="grid max-w-[860px] gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Group title="Business">
        <label className="field"><span>Business name</span><input className="input" name="businessName" required maxLength={200} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            <span>Industry</span>
            <select className="input" name="industry" defaultValue="barbershop">
              <option value="barbershop">Barbershop</option>
              <option value="dental">Dental practice</option>
              <option value="law_office">Solicitors / law office</option>
              <option value="generic_service">Other appointment-based business</option>
            </select>
          </label>
          <label className="field">
            <span>Country</span>
            <select className="input" name="country" defaultValue="IE">
              <option value="IE">Ireland</option>
              <option value="HR">Croatia</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field"><span>Street address</span><input className="input" name="addressLine" /></label>
          <label className="field"><span>Town or city</span><input className="input" name="city" /></label>
        </div>
        <label className="field"><span>Website (optional)</span><input className="input" name="websiteUrl" type="url" placeholder="https://" /></label>
      </Group>

      <Group title="Language" hint="What the assistant speaks first. Callers can switch if you allow both.">
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2"><input type="radio" name="primaryLanguage" value="en" defaultChecked className="accent-action" /> English</label>
          <label className="flex items-center gap-2"><input type="radio" name="primaryLanguage" value="hr" className="accent-action" /> Croatian</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="bilingual" className="accent-action" /> Also answer in the other language</label>
        </div>
      </Group>

      <Group title="Contacts" hint="The fallback number gets calls the assistant can’t handle, and all calls during an outage.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field"><span>Business email</span><input className="input" name="contactEmail" type="email" required /></label>
          <label className="field"><span>Owner’s email (gets the invitation)</span><input className="input" name="ownerEmail" type="email" required /></label>
        </div>
        <label className="field sm:max-w-[50%]"><span>Fallback phone number</span><input className="input tnum" name="fallbackPhone" type="tel" placeholder="087 123 4567" /></label>
      </Group>

      <Group title="Opening hours" hint="A starting point. The owner can fine-tune each day later.">
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5"><input type="checkbox" name={`day-${i + 1}`} defaultChecked={i < 5} className="accent-action" />{d}</label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input aria-label="Opens" className="input tnum w-[7rem]" type="time" name="opens" defaultValue="09:00" />
          <span className="text-ink-faint">to</span>
          <input aria-label="Closes" className="input tnum w-[7rem]" type="time" name="closes" defaultValue="17:30" />
        </div>
      </Group>

      <Group title="Staff" hint="One name per line. Leave empty for businesses where callers don’t choose a person.">
        <textarea className="input min-h-[96px]" name="staff" placeholder={'Mark\nAoife'} />
      </Group>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Creating client…' : 'Create client'}</button>
        <p className="text-[0.85rem] text-ink-soft">Services are filled in from the industry template; prices stay unapproved until the owner confirms them.</p>
        {state.error ? <p role="alert" className="basis-full text-lamp-red">{state.error}</p> : null}
      </div>
    </form>
  );
}
