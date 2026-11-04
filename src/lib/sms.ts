/**
 * SMS length / segment estimation.
 * - GSM-7: 160 chars in one part, 153 per part when split (extension chars count as 2).
 * - UCS-2 (any Arabic or other non-GSM char): 70 chars in one part, 67 per part when split.
 */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** length in encoding units (GSM septets or UTF-16 code units) */
  units: number;
  segments: number;
  /** capacity of a single-part message for this encoding */
  singleLimit: number;
  /** capacity per part of a multi-part message */
  perPart: number;
  /** units remaining before another part is needed */
  remainingInPart: number;
}

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM_BASIC.includes(ch) && !GSM_EXT.includes(ch)) return false;
  }
  return true;
}

export function segmentInfo(text: string): SegmentInfo {
  const t = text || '';
  if (isGsm7(t)) {
    let units = 0;
    for (const ch of t) units += GSM_EXT.includes(ch) ? 2 : 1;
    return build('GSM-7', units, 160, 153);
  }
  return build('UCS-2', t.length, 70, 67);
}

function build(encoding: SmsEncoding, units: number, singleLimit: number, perPart: number): SegmentInfo {
  const segments = units === 0 ? 0 : units <= singleLimit ? 1 : Math.ceil(units / perPart);
  const remainingInPart =
    units === 0 ? singleLimit : segments === 1 ? singleLimit - units : segments * perPart - units;
  return { encoding, units, segments, singleLimit, perPart, remainingInPart };
}

export interface CampaignEstimate {
  messages: number;
  totalSegments: number;
  maxSegmentsPerMessage: number;
  /** null when no price is given */
  estimatedCost: number | null;
}

export function estimateCampaign(contents: string[], pricePerSegment?: number | null): CampaignEstimate {
  let totalSegments = 0;
  let maxSegmentsPerMessage = 0;
  for (const c of contents) {
    const s = segmentInfo(c).segments;
    totalSegments += s;
    if (s > maxSegmentsPerMessage) maxSegmentsPerMessage = s;
  }
  const price = typeof pricePerSegment === 'number' && isFinite(pricePerSegment) && pricePerSegment >= 0 ? pricePerSegment : null;
  return {
    messages: contents.length,
    totalSegments,
    maxSegmentsPerMessage,
    estimatedCost: price === null ? null : Math.round(totalSegments * price * 1000) / 1000,
  };
}
