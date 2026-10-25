import type { Language } from '../i18n/locale';
import { formatSlotForSpeech } from '../i18n/locale';

/**
 * Notification templates. Plain, short, no marketing. Customer messages never include anything beyond
 * what the customer told us; staff messages never include fields marked sensitive.
 */
export type NotificationTemplate =
  | 'booking_confirmed_customer'
  | 'booking_cancelled_customer'
  | 'booking_created_staff'
  | 'booking_cancelled_staff'
  | 'booking_needs_check_staff'
  | 'enquiry_staff'
  | 'appointment_reminder_customer'
  | 'daily_summary_staff';

export interface RenderedMessage {
  subject: string;
  text: string;
}

export interface BookingMessageData {
  businessName: string;
  serviceName: string;
  staffName: string;
  start: string; // ISO instant
  timezone: string;
  reference?: string;
  customerName?: string;
  customerPhone?: string | null;
  addressLine?: string | null;
}

export interface EnquiryMessageData {
  businessName: string;
  kind: 'message' | 'callback' | 'lead' | 'voicemail';
  urgent: boolean;
  callerName: string | null;
  callbackPhone: string | null;
  summary: string | null;
  fields: Record<string, string>;
  dashboardUrl: string;
}

export interface DailySummaryData {
  businessName: string;
  date: string;
  calls: number;
  bookings: number;
  openMessages: number;
  dashboardUrl: string;
}

const KIND: Record<Language, Record<EnquiryMessageData['kind'], string>> = {
  en: { message: 'New message', callback: 'Callback request', lead: 'New enquiry', voicemail: 'New voicemail' },
  hr: { message: 'Nova poruka', callback: 'Zahtjev za povratni poziv', lead: 'Novi upit', voicemail: 'Nova glasovna poruka' },
};

export function renderBookingMessage(template: NotificationTemplate, lang: Language, d: BookingMessageData): RenderedMessage {
  const when = formatSlotForSpeech(d.start, d.timezone, lang);
  const en = lang === 'en';
  switch (template) {
    case 'booking_confirmed_customer':
      return {
        subject: en ? `Booking confirmed: ${d.businessName}` : `Rezervacija potvrđena: ${d.businessName}`,
        text: en
          ? `Your ${d.serviceName} with ${d.staffName} at ${d.businessName} is booked for ${when}.` +
            (d.reference ? ` Booking reference: ${d.reference}. You'll need it to change or cancel by phone.` : '') +
            (d.addressLine ? ` Address: ${d.addressLine}.` : '')
          : `Vaš termin (${d.serviceName}, ${d.staffName}) u ${d.businessName} rezerviran je za ${when}.` +
            (d.reference ? ` Broj rezervacije: ${d.reference}. Potreban je za promjenu ili otkazivanje telefonom.` : '') +
            (d.addressLine ? ` Adresa: ${d.addressLine}.` : ''),
      };
    case 'appointment_reminder_customer':
      return {
        subject: en ? `Reminder: ${d.businessName}` : `Podsjetnik: ${d.businessName}`,
        text: en
          ? `Reminder: ${d.serviceName} with ${d.staffName} at ${d.businessName}, ${when}. To change it, call us and quote ${d.reference ?? 'your booking reference'}.`
          : `Podsjetnik: ${d.serviceName}, ${d.staffName}, ${d.businessName}, ${when}. Za promjenu nas nazovite i navedite broj ${d.reference ?? 'rezervacije'}.`,
      };
    case 'booking_cancelled_customer':
      return {
        subject: en ? `Booking cancelled: ${d.businessName}` : `Rezervacija otkazana: ${d.businessName}`,
        text: en
          ? `Your ${d.serviceName} at ${d.businessName} on ${when} has been cancelled.`
          : `Vaš termin (${d.serviceName}) u ${d.businessName}, ${when}, je otkazan.`,
      };
    case 'booking_created_staff':
      return {
        subject: en ? `New booking: ${when}` : `Nova rezervacija: ${when}`,
        text: en
          ? `${d.customerName ?? 'A caller'} booked ${d.serviceName} with ${d.staffName} for ${when} by phone.${d.customerPhone ? ` Phone: ${d.customerPhone}.` : ''}`
          : `${d.customerName ?? 'Pozivatelj'} je telefonom rezervirao ${d.serviceName} kod ${d.staffName} za ${when}.${d.customerPhone ? ` Telefon: ${d.customerPhone}.` : ''}`,
      };
    case 'booking_cancelled_staff':
      return {
        subject: en ? `Cancelled: ${when}` : `Otkazano: ${when}`,
        text: en
          ? `${d.customerName ?? 'A customer'} cancelled ${d.serviceName} with ${d.staffName} on ${when}. The time is free again.`
          : `${d.customerName ?? 'Klijent'} je otkazao ${d.serviceName} kod ${d.staffName}, ${when}. Termin je ponovno slobodan.`,
      };
    case 'booking_needs_check_staff':
      return {
        subject: en ? `Please check a booking: ${when}` : `Molimo provjerite rezervaciju: ${when}`,
        text: en
          ? `We couldn't confirm with your calendar whether ${d.customerName ?? 'a caller'}'s ${d.serviceName} on ${when} was saved. The caller was told you'd confirm. Please check your calendar and contact them${d.customerPhone ? ` on ${d.customerPhone}` : ''}.`
          : `Nismo mogli potvrditi s vašim kalendarom je li spremljen termin (${d.serviceName}, ${when}) za ${d.customerName ?? 'pozivatelja'}. Pozivatelju je rečeno da ćete potvrditi. Provjerite kalendar i javite se${d.customerPhone ? ` na ${d.customerPhone}` : ''}.`,
      };
    default:
      throw new Error(`Not a booking template: ${template}`);
  }
}

export function renderEnquiryMessage(lang: Language, d: EnquiryMessageData): RenderedMessage {
  const en = lang === 'en';
  const lines = [
    `${d.urgent ? (en ? 'URGENT. ' : 'HITNO. ') : ''}${KIND[lang][d.kind]}${d.callerName ? (en ? ` from ${d.callerName}` : `: ${d.callerName}`) : ''}.`,
    d.callbackPhone ? `${en ? 'Call back on' : 'Nazvati na'}: ${d.callbackPhone}` : '',
    d.summary ?? '',
    ...Object.entries(d.fields).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`),
    '',
    `${en ? 'Open in your dashboard' : 'Otvorite na nadzornoj ploči'}: ${d.dashboardUrl}`,
  ].filter((l, i) => l !== '' || i > 3);
  return {
    subject: `${d.urgent ? (en ? 'Urgent: ' : 'Hitno: ') : ''}${KIND[lang][d.kind]} – ${d.businessName}`,
    text: lines.join('\n').trim(),
  };
}

export function renderDailySummary(lang: Language, d: DailySummaryData): RenderedMessage {
  const en = lang === 'en';
  return {
    subject: en ? `${d.businessName}: today on the phone` : `${d.businessName}: današnji pozivi`,
    text: en
      ? `${d.date}: ${d.calls} calls answered, ${d.bookings} bookings made by phone, ${d.openMessages} messages waiting.\n${d.dashboardUrl}`
      : `${d.date}: ${d.calls} odgovorenih poziva, ${d.bookings} rezervacija telefonom, ${d.openMessages} poruka čeka odgovor.\n${d.dashboardUrl}`,
  };
}
