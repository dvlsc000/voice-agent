import { publishVersion, provisionClient, renderBusinessFacts, type CreateClientInput, type Db } from '@vp/server';

/**
 * Demo businesses for the browser playground. Created once (idempotent on the key) in whatever database the
 * playground points at — use the DEVELOPMENT project, never production. Their "phone numbers" are fictional
 * routing keys with provider 'playground'; nothing is bought or dialled.
 */
export interface DemoSpec {
  key: string;
  number: string;
  input: CreateClientInput;
}

const week = (days: number[], opens: string, closes: string) => days.map((weekday) => ({ weekday, opens, closes }));

export const DEMO_BUSINESSES: DemoSpec[] = [
  {
    key: 'playground:barber-ie',
    number: '+35315550101',
    input: {
      businessName: 'Demo Barbers Dublin', industry: 'barbershop', country: 'IE', primaryLanguage: 'en', city: 'Dublin', addressLine: '12 Camden Street',
      contactEmail: 'demo-barbers@example.com', ownerEmail: 'demo-barbers@example.com', fallbackPhone: '01 555 0199',
      hours: week([1, 2, 3, 4, 5, 6], '09:00', '18:00'), staff: [{ name: 'Mark' }, { name: 'Aoife' }],
    },
  },
  {
    key: 'playground:dental-ie',
    number: '+35315550102',
    input: {
      businessName: 'Demo Dental Galway', industry: 'dental', country: 'IE', primaryLanguage: 'en', city: 'Galway', addressLine: '4 Shop Street',
      contactEmail: 'demo-dental@example.com', ownerEmail: 'demo-dental@example.com', fallbackPhone: '01 555 0198',
      hours: week([1, 2, 3, 4, 5], '08:30', '17:00'), staff: [{ name: 'Dr Byrne' }, { name: 'Dr Kelly' }],
    },
  },
  {
    key: 'playground:law-ie',
    number: '+35315550103',
    input: {
      businessName: 'Demo Solicitors Cork', industry: 'law_office', country: 'IE', primaryLanguage: 'en', city: 'Cork', addressLine: '20 South Mall',
      contactEmail: 'demo-law@example.com', ownerEmail: 'demo-law@example.com', fallbackPhone: '01 555 0197',
      hours: week([1, 2, 3, 4, 5], '09:00', '17:30'), staff: [{ name: 'Ciara Murphy' }],
    },
  },
  {
    key: 'playground:barber-hr',
    number: '+38515550104',
    input: {
      businessName: 'Demo Brijačnica Zagreb', industry: 'barbershop', country: 'HR', primaryLanguage: 'hr', city: 'Zagreb', addressLine: 'Ilica 10',
      contactEmail: 'demo-brijacnica@example.com', ownerEmail: 'demo-brijacnica@example.com', fallbackPhone: '01 555 0196',
      hours: week([1, 2, 3, 4, 5, 6], '08:00', '20:00'), staff: [{ name: 'Ivan' }, { name: 'Petra' }],
    },
  },
];

export interface DemoBusiness {
  slug: string;
  name: string;
  industry: string;
  country: 'IE' | 'HR';
  language: 'en' | 'hr';
  number: string;
  timezone: string;
  facts: string;
}

/** Make sure every demo business exists, is live, has a published assistant and a routing number. */
export async function ensureDemoBusinesses(db: Db, log: (msg: string) => void = () => undefined): Promise<DemoBusiness[]> {
  const out: DemoBusiness[] = [];
  for (const d of DEMO_BUSINESSES) {
    const r = await provisionClient(db, d.input, { actorUserId: null, idempotencyKey: d.key });
    const org = r.organizationId;
    const state = (
      await db.query(
        `select o.status, o.slug, o.name, o.country, o.primary_language, o.timezone, a.active_version_id,
                (select count(*) from public.phone_numbers p where p.organization_id = o.id and p.status = 'active')::int as numbers
           from public.organizations o join public.agents a on a.organization_id = o.id where o.id = $1 limit 1`,
        [org],
      )
    ).rows[0];
    if (!state.active_version_id) {
      // Demo prices are the template's suggestions; approve them so the assistant may quote them.
      await db.query(`update public.services set price_approved = true where organization_id = $1`, [org]);
      await publishVersion(db, { versionId: r.agentVersionId, actorUserId: null, skipTestsReason: 'Playground demo business' });
      log(`Published assistant for ${state.name}`);
    }
    if (state.numbers === 0) {
      await db.query(
        `insert into public.phone_numbers (organization_id, e164, country, connection_type, provider, status, agent_id)
         values ($1, $2, $3, 'provider_number', 'playground', 'active', $4)`,
        [org, d.number, d.input.country, r.agentId],
      );
    }
    if (state.status !== 'active') {
      await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
      log(`Created demo business ${state.name}`);
    }
    out.push({
      slug: state.slug,
      name: state.name,
      industry: d.input.industry,
      country: state.country,
      language: state.primary_language,
      number: d.number,
      timezone: state.timezone,
      facts: await renderBusinessFacts(db, org, state.primary_language),
    });
  }
  return out;
}
