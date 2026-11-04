/**
 * Phone validation / normalisation for Palestinian mobile numbers.
 *
 * Accepted mobile inputs (all normalise to local form 05XXXXXXXX):
 *   0599123456, 599123456 (leading zero lost by Excel), +970599123456, 00970599123456,
 *   970599123456, +972..., with spaces/dashes and Arabic-Indic digits.
 * Landlines (02/04/08/09 + 7 digits) are recognised but are NOT SMS/WhatsApp capable.
 */

export type PhoneProblem = 'missing' | 'invalid' | 'landline' | 'placeholder';

export interface PhoneCheck {
  /** True only for a mobile number that can receive SMS/WhatsApp. */
  valid: boolean;
  /** Local form, e.g. 0599123456 (empty when invalid). */
  local: string;
  /** Country code found in the input ('970' / '972'), if any. */
  countryCode?: '970' | '972';
  problem?: PhoneProblem;
}

/** Known fake/placeholder numbers that older versions inserted when a phone was missing. */
export const PLACEHOLDER_PHONES = new Set(['0590000000', '0599000000', '0500000000', '0560000000']);

function toAsciiDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0));
}

export function checkPhone(raw: unknown): PhoneCheck {
  if (raw === undefined || raw === null) return { valid: false, local: '', problem: 'missing' };
  const str = toAsciiDigits(String(raw)).trim();
  if (!str) return { valid: false, local: '', problem: 'missing' };

  let digits = str.replace(/\D/g, '');
  if (!digits) return { valid: false, local: '', problem: 'invalid' };

  let countryCode: '970' | '972' | undefined;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if ((digits.startsWith('970') || digits.startsWith('972')) && digits.length >= 12) {
    countryCode = digits.slice(0, 3) as '970' | '972';
    digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1); // e.g. +970 0599...
  }

  let local = '';
  if (/^05\d{8}$/.test(digits)) local = digits;
  else if (/^5\d{8}$/.test(digits)) local = '0' + digits;

  if (local) {
    if (PLACEHOLDER_PHONES.has(local) || /^05(\d)\1{7}$/.test(local)) {
      return { valid: false, local: '', countryCode, problem: 'placeholder' };
    }
    return { valid: true, local, countryCode };
  }

  if (/^0?[2489]\d{7}$/.test(digits)) return { valid: false, local: '', countryCode, problem: 'landline' };
  return { valid: false, local: '', countryCode, problem: 'invalid' };
}

export function isSendablePhone(raw: unknown): boolean {
  return checkPhone(raw).valid;
}

/** International form with '+' (defaults to +970 like the previous behaviour). '' if invalid. */
export function toInternational(raw: unknown): string {
  const c = checkPhone(raw);
  if (!c.valid) return '';
  return '+' + (c.countryCode ?? '970') + c.local.slice(1);
}

export const PHONE_PROBLEM_LABELS: Record<PhoneProblem, string> = {
  missing: 'لا يوجد رقم',
  invalid: 'رقم غير صالح',
  landline: 'رقم أرضي لا يستقبل الرسائل',
  placeholder: 'رقم وهمي/افتراضي',
};
