/**
 * WhatsApp text generator for a single section's quiz/assignment window.
 * The copied block must contain that section's launcher link only.
 */
import type { SectionEvent } from './sectionEvents';
import { eventLabel, formatCloseDate } from './sectionEvents';

export const DEFAULT_WA_SIGNATURE = '🌟 تمنياتي بالتوفيق 🤍 .. معلمكم / محمد أبو زهري 📚✨';

export function buildWhatsAppBlurb(event: SectionEvent, signature: string = DEFAULT_WA_SIGNATURE): string {
  const lines: string[] = [];
  const title = event.title.trim() || 'تذكير بالاختبار';
  const label = eventLabel(event);
  lines.push(label ? `${title} — ${label}` : title);
  if (event.duration.trim()) lines.push(`المدة: ${event.duration.trim()}`);
  if (event.attempts.trim()) lines.push(`المحاولات: ${event.attempts.trim()}`);
  const close = formatCloseDate(event);
  if (close) lines.push(`موعد الإغلاق: ${close}`);
  if (event.url.trim()) lines.push(`رابط فتح الاختبار: ${event.url.trim()}`);
  const sig = signature.trim();
  if (sig) lines.push(sig);
  return lines.join('\n');
}

/** True when `text` contains a launcher URL that does not belong to `event`. */
export function blurbMixesOtherSectionLink(text: string, event: SectionEvent, others: SectionEvent[]): boolean {
  const own = event.url.trim();
  for (const o of others) {
    const url = o.url.trim();
    if (!url || url === own) continue;
    if (text.includes(url)) return true;
  }
  return false;
}
