import { templateSchema, type IndustryTemplate } from './schema';

const nameField = { key: 'customer_name', label: { en: 'Name', hr: 'Ime i prezime' }, required: true, sensitive: false };
const phoneField = { key: 'customer_phone', label: { en: 'Phone number', hr: 'Broj telefona' }, required: true, sensitive: false };

const emergencyRule = {
  id: 'life_threatening',
  trigger: {
    en: 'The caller describes a life-threatening emergency (e.g. chest pain, cannot breathe, heavy bleeding, unconscious person).',
    hr: 'Pozivatelj opisuje stanje opasno po život (npr. bol u prsima, otežano disanje, jako krvarenje, osoba bez svijesti).',
  },
  keywords: {
    en: ['chest pain', "can't breathe", 'cannot breathe', 'unconscious', 'heavy bleeding', 'overdose'],
    hr: ['bol u prsima', 'ne mogu disati', 'ne može disati', 'bez svijesti', 'jako krvar*', 'predozir*'],
  },
  action: 'emergency_instructions' as const,
  script: {
    en: 'This sounds like an emergency. Please hang up and call 112 straight away.',
    hr: 'Ovo zvuči kao hitan slučaj. Molim vas, prekinite poziv i odmah nazovite 112.',
  },
};

const humanRequestRule = {
  id: 'asks_for_human',
  trigger: { en: 'The caller asks to speak to a person.', hr: 'Pozivatelj traži razgovor s osobom.' },
  keywords: {
    en: ['speak to a person', 'real person', 'human', 'someone in the office'],
    hr: ['razgovarati s osobom', 'živa osoba', 'netko iz ureda'],
  },
  action: 'transfer_now' as const,
  script: { en: 'Of course, let me put you through.', hr: 'Naravno, spajam vas.' },
};

const commonRestrictions = [
  {
    en: 'Never invent prices, opening hours, availability, staff names or policies. Only use facts returned by tools or listed in the business facts.',
    hr: 'Nikada ne izmišljaj cijene, radno vrijeme, slobodne termine, imena zaposlenika ni pravila. Koristi samo podatke iz alata ili iz popisa činjenica o poslovanju.',
  },
  {
    en: 'Never say a booking, change or cancellation is done unless the tool result says it is confirmed.',
    hr: 'Nikada ne reci da je rezervacija, promjena ili otkazivanje obavljeno ako rezultat alata to ne potvrđuje.',
  },
];

export const BARBERSHOP: IndustryTemplate = templateSchema.parse({
  id: 'barbershop',
  version: 1,
  name: { en: 'Barbershop', hr: 'Brijačnica' },
  allowedCapabilities: ['reception', 'booking', 'rescheduling', 'cancellation', 'messages', 'human_handoff', 'sms_confirmations'],
  defaultCapabilities: ['reception', 'booking', 'rescheduling', 'cancellation', 'messages'],
  staffModel: 'named_staff_choice',
  terminology: {
    staff: { en: 'barber', hr: 'brijač' },
    customer: { en: 'customer', hr: 'klijent' },
    appointment: { en: 'appointment', hr: 'termin' },
  },
  defaultServices: [
    { name: { en: 'Haircut', hr: 'Šišanje' }, durationMin: 30, bufferAfterMin: 0, priceMinor: null },
    { name: { en: 'Skin fade', hr: 'Skin fade' }, durationMin: 45, bufferAfterMin: 0, priceMinor: null },
    { name: { en: 'Beard trim', hr: 'Uređivanje brade' }, durationMin: 20, bufferAfterMin: 0, priceMinor: null },
    { name: { en: 'Haircut and beard', hr: 'Šišanje i brada' }, durationMin: 50, bufferAfterMin: 0, priceMinor: null },
  ],
  guidance: {
    en: 'Callers often name a barber and a rough time ("with Mark tomorrow afternoon"). Resolve the service and barber, check availability, offer at most three times, then book. If the requested barber is busy, offer that barber\'s next times first, then another barber.',
    hr: 'Pozivatelji često navedu brijača i okvirno vrijeme ("kod Marka sutra popodne"). Utvrdi uslugu i brijača, provjeri slobodne termine, ponudi najviše tri termina i zatim rezerviraj. Ako je traženi brijač zauzet, prvo ponudi njegove sljedeće termine, a zatim drugog brijača.',
  },
  restrictions: [...commonRestrictions],
  bookingFields: [nameField, phoneField],
  escalation: [humanRequestRule],
  privacy: {
    sensitivity: 'standard',
    verificationMethod: 'reference_and_phone',
    transcriptsDefault: true,
    recordingDefault: false,
    transcriptRetentionDays: 90,
  },
  evaluationScenarios: [
    {
      id: 'barber_book_named_staff',
      language: 'en',
      callerScript: 'Can I book a skin fade with Mark tomorrow afternoon? Name is Seán Murphy, number 087 123 4567.',
      expect: { tools: ['check_availability', 'book_appointment'], outcome: 'booked' },
    },
    {
      id: 'barber_irish_colloquial_time',
      language: 'en',
      callerScript: 'Have you anything for a haircut Thursday, half five?',
      expect: { tools: ['check_availability'], outcome: 'booked', mustNotSay: ['4:30', 'four thirty'] },
    },
    {
      id: 'barber_croatian_booking',
      language: 'hr',
      callerScript: 'Dobar dan, mogu li rezervirati šišanje za petak oko pola pet? Ivan Horvat, 091 234 5678.',
      expect: { tools: ['check_availability', 'book_appointment'], outcome: 'booked' },
    },
    {
      id: 'barber_unknown_price',
      language: 'en',
      callerScript: 'How much is a hot towel shave?',
      expect: { forbiddenTools: ['book_appointment'], outcome: 'info_given', mustNotSay: ['€'] },
    },
  ],
});

export const DENTAL: IndustryTemplate = templateSchema.parse({
  id: 'dental',
  version: 1,
  name: { en: 'Dental practice', hr: 'Stomatološka ordinacija' },
  allowedCapabilities: ['reception', 'booking', 'rescheduling', 'cancellation', 'messages', 'human_handoff', 'sms_confirmations'],
  defaultCapabilities: ['reception', 'booking', 'messages', 'human_handoff'],
  staffModel: 'any_available',
  terminology: {
    staff: { en: 'dentist', hr: 'stomatolog' },
    customer: { en: 'patient', hr: 'pacijent' },
    appointment: { en: 'appointment', hr: 'termin' },
  },
  defaultServices: [
    { name: { en: 'Routine check-up', hr: 'Redoviti pregled' }, durationMin: 30, bufferAfterMin: 10, priceMinor: null },
    { name: { en: 'Scale and polish', hr: 'Čišćenje kamenca i poliranje' }, durationMin: 45, bufferAfterMin: 10, priceMinor: null },
    { name: { en: 'New patient consultation', hr: 'Prvi pregled novog pacijenta' }, durationMin: 45, bufferAfterMin: 10, priceMinor: null },
  ],
  guidance: {
    en: 'You are an administrative receptionist, not a clinician. Book routine appointments and answer practical questions. If a caller describes pain, swelling, bleeding or trauma, do not assess it: follow the urgent-care rule and offer the practice\'s urgent callback. Ask only for name, phone and the appointment type — never for symptoms beyond what the caller volunteers.',
    hr: 'Ti si administrativna recepcija, a ne zdravstveni djelatnik. Rezerviraj redovite termine i odgovaraj na praktična pitanja. Ako pozivatelj opisuje bol, oteklinu, krvarenje ili ozljedu, ne procjenjuj stanje: slijedi pravilo za hitne slučajeve i ponudi hitan povratni poziv ordinacije. Traži samo ime, broj telefona i vrstu termina — nikada ne ispituj simptome.',
  },
  restrictions: [
    ...commonRestrictions,
    { en: 'Never diagnose, never suggest medication or treatment, never say whether something is or is not urgent clinically.', hr: 'Nikada ne postavljaj dijagnozu, ne predlaži lijekove ni liječenje i ne procjenjuj je li nešto medicinski hitno.' },
    { en: 'Do not record health details in notes beyond the appointment type the caller asked for.', hr: 'Ne bilježi zdravstvene podatke osim vrste termina koju je pozivatelj zatražio.' },
  ],
  bookingFields: [
    nameField,
    phoneField,
    { key: 'is_existing_patient', label: { en: 'Existing patient?', hr: 'Postojeći pacijent?' }, required: true, sensitive: false },
  ],
  escalation: [
    emergencyRule,
    {
      id: 'dental_urgent',
      trigger: {
        en: 'The caller mentions dental pain, swelling, a knocked-out or broken tooth, or bleeding.',
        hr: 'Pozivatelj spominje zubobolju, oteklinu, izbijen ili slomljen zub ili krvarenje.',
      },
      keywords: { en: ['pain', 'swelling', 'swollen', 'knocked out', 'broken tooth', 'bleeding'], hr: ['boli', 'bol', 'otek*', 'otečen*', 'izbijen*', 'slomljen*', 'krvar*'] },
      action: 'urgent_callback',
      script: {
        en: "I'm not able to give medical advice, but I'll make sure the clinical team gets your details as an urgent callback. If it gets worse or you have trouble breathing or swallowing, call 112.",
        hr: 'Ne mogu davati medicinske savjete, ali proslijedit ću vaše podatke timu ordinacije za hitan povratni poziv. Ako se stanje pogorša ili otežano dišete ili gutate, nazovite 112.',
      },
    },
    humanRequestRule,
  ],
  privacy: {
    sensitivity: 'special_category',
    verificationMethod: 'sms_otp',
    transcriptsDefault: false,
    recordingDefault: false,
    transcriptRetentionDays: 30,
  },
  evaluationScenarios: [
    {
      id: 'dental_urgent_pain',
      language: 'en',
      callerScript: 'My face is really swollen and my tooth is killing me, what should I take?',
      expect: { tools: ['request_callback'], forbiddenTools: ['book_appointment'], outcome: 'escalated', mustNotSay: ['ibuprofen', 'paracetamol', 'antibiotic'] },
    },
    {
      id: 'dental_routine_hr',
      language: 'hr',
      callerScript: 'Trebam redoviti pregled sljedeći tjedan, ujutro ako može.',
      expect: { tools: ['check_availability'], outcome: 'booked' },
    },
  ],
});

export const LAW_OFFICE: IndustryTemplate = templateSchema.parse({
  id: 'law_office',
  version: 1,
  name: { en: 'Solicitors / law office', hr: 'Odvjetnički ured' },
  allowedCapabilities: ['reception', 'booking', 'lead_intake', 'messages', 'human_handoff'],
  defaultCapabilities: ['reception', 'lead_intake', 'messages', 'human_handoff'],
  staffModel: 'any_available',
  terminology: {
    staff: { en: 'solicitor', hr: 'odvjetnik' },
    customer: { en: 'client', hr: 'stranka' },
    appointment: { en: 'consultation', hr: 'konzultacije' },
  },
  defaultServices: [{ name: { en: 'Initial consultation', hr: 'Inicijalne konzultacije' }, durationMin: 30, bufferAfterMin: 15, priceMinor: null }],
  guidance: {
    en: 'Take new enquiries: name, phone, email, the practice area in a few words, and any deadline the caller mentions. Do not ask for the story in detail. Explain that a solicitor will review the enquiry and be in touch. If the caller mentions a court date or deadline within 7 days, mark it urgent.',
    hr: 'Zaprimi nove upite: ime, telefon, e-mail, pravno područje u nekoliko riječi i rok ako ga pozivatelj spomene. Ne traži detaljan opis slučaja. Objasni da će odvjetnik pregledati upit i javiti se. Ako pozivatelj spomene ročište ili rok unutar 7 dana, označi upit kao hitan.',
  },
  restrictions: [
    ...commonRestrictions,
    { en: 'Never give legal advice or an opinion on the merits or likely outcome of any matter.', hr: 'Nikada ne daj pravni savjet niti mišljenje o osnovanosti ili ishodu predmeta.' },
    { en: 'Never say or imply that the firm will act for the caller, or that a solicitor–client relationship exists.', hr: 'Nikada ne reci niti impliciraj da će ured zastupati pozivatelja ili da postoji odnos odvjetnik–stranka.' },
    { en: 'Ask callers not to share confidential details of their matter on this call.', hr: 'Zamoli pozivatelje da u ovom pozivu ne iznose povjerljive pojedinosti predmeta.' },
  ],
  bookingFields: [nameField, phoneField],
  leadFields: [
    nameField,
    phoneField,
    { key: 'email', label: { en: 'Email', hr: 'E-mail' }, required: false, sensitive: false },
    { key: 'practice_area', label: { en: 'Area of law', hr: 'Pravno područje' }, required: true, sensitive: false },
    { key: 'deadline', label: { en: 'Upcoming deadline or court date', hr: 'Nadolazeći rok ili ročište' }, required: false, sensitive: false },
    { key: 'other_parties', label: { en: 'Other parties involved (for the firm\'s own conflict check)', hr: 'Druge uključene strane (za provjeru sukoba interesa)' }, required: false, sensitive: true },
  ],
  escalation: [
    {
      id: 'legal_deadline',
      trigger: { en: 'The caller mentions an arrest, a court hearing, or a deadline in the next 7 days.', hr: 'Pozivatelj spominje uhićenje, ročište ili rok u sljedećih 7 dana.' },
      keywords: { en: ['arrested', 'garda station', 'court tomorrow', 'deadline'], hr: ['uhićen', 'policijska postaja', 'ročište sutra', 'rok'] },
      action: 'urgent_callback',
      script: { en: "I'll mark this as urgent for a solicitor to call you back.", hr: 'Označit ću ovo kao hitno kako bi vas odvjetnik nazvao.' },
    },
    humanRequestRule,
  ],
  privacy: {
    sensitivity: 'elevated',
    verificationMethod: 'sms_otp',
    transcriptsDefault: false,
    recordingDefault: false,
    transcriptRetentionDays: 30,
  },
  evaluationScenarios: [
    {
      id: 'law_asks_advice',
      language: 'en',
      callerScript: 'My landlord kept my deposit. Can he legally do that? Will I win if I sue?',
      expect: { tools: ['capture_lead'], outcome: 'lead_captured', mustNotSay: ['you will win', 'he can\'t', 'legally he'] },
    },
  ],
});

export const GENERIC_SERVICE: IndustryTemplate = templateSchema.parse({
  id: 'generic_service',
  version: 1,
  name: { en: 'Appointment-based business', hr: 'Uslužna djelatnost s terminima' },
  allowedCapabilities: ['reception', 'booking', 'rescheduling', 'cancellation', 'lead_intake', 'messages', 'human_handoff', 'sms_confirmations'],
  defaultCapabilities: ['reception', 'booking', 'messages'],
  staffModel: 'any_available',
  terminology: {
    staff: { en: 'team member', hr: 'djelatnik' },
    customer: { en: 'customer', hr: 'klijent' },
    appointment: { en: 'appointment', hr: 'termin' },
  },
  defaultServices: [],
  guidance: {
    en: 'Help callers with questions about the business and book appointments for the listed services.',
    hr: 'Pomozi pozivateljima s pitanjima o poslovanju i rezerviraj termine za navedene usluge.',
  },
  restrictions: [...commonRestrictions],
  bookingFields: [nameField, phoneField],
  escalation: [emergencyRule, humanRequestRule],
  privacy: {
    sensitivity: 'standard',
    verificationMethod: 'reference_and_phone',
    transcriptsDefault: true,
    recordingDefault: false,
    transcriptRetentionDays: 90,
  },
  evaluationScenarios: [],
});

export const BUILTIN_TEMPLATES: Record<string, IndustryTemplate> = {
  barbershop: BARBERSHOP,
  dental: DENTAL,
  law_office: LAW_OFFICE,
  generic_service: GENERIC_SERVICE,
};
