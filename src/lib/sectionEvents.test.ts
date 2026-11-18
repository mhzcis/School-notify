import { describe, expect, it } from 'vitest';
import { buildQuizLauncherUrl, buildSectionEvent, extractLauncherQuizId, findSectionEvent, formatCloseDate, QUIZ_LAUNCHER_BASE } from './sectionEvents';
import { blurbMixesOtherSectionLink, buildWhatsAppBlurb } from './whatsappBlurb';

describe('quiz launcher URLs', () => {
  it('builds a per-quiz launcher link from an id or a URL with ?id=', () => {
    expect(buildQuizLauncherUrl('123456')).toBe(`${QUIZ_LAUNCHER_BASE}?id=123456`);
    expect(buildQuizLauncherUrl(`${QUIZ_LAUNCHER_BASE}?id=123456`)).toBe(`${QUIZ_LAUNCHER_BASE}?id=123456`);
    expect(buildQuizLauncherUrl('https://example.invalid/mod/quiz/view.php?id=123456')).toBe(`${QUIZ_LAUNCHER_BASE}?id=123456`);
    expect(extractLauncherQuizId('123456')).toBe('123456');
  });

  it('finds the event of one section and formats the close label', () => {
    const a = buildSectionEvent({
      grade: 'رابع', section: 'أ', title: 'اختبار تجريبي',
      url: '111111', closeLabel: 'الخميس 12/11/2026 الساعة 11:59 مساءً',
      duration: '30 دقيقة', attempts: 'محاولة واحدة',
    });
    const b = buildSectionEvent({
      grade: 'رابع', section: 'ب', title: 'اختبار تجريبي',
      url: '222222', closeLabel: 'الخميس 12/11/2026 الساعة 11:59 مساءً',
    });
    expect(a.url).toBe(`${QUIZ_LAUNCHER_BASE}?id=111111`);
    expect(findSectionEvent([a, b], 'رابع', 'أ')?.url).toBe(a.url);
    expect(findSectionEvent([a, b], 'رابع', 'ب')?.url).toBe(b.url);
    expect(formatCloseDate(a)).toBe('الخميس 12/11/2026 الساعة 11:59 مساءً');
  });
});

describe('WhatsApp blurb', () => {
  it('copies the approved block for one section and never includes another section link', () => {
    const a = buildSectionEvent({
      grade: 'رابع', section: 'أ', title: 'اختبار تجريبي للأسبوع',
      url: '111111', closeLabel: 'الخميس ظهراً', duration: '30 دقيقة', attempts: 'محاولة واحدة',
    });
    const b = buildSectionEvent({
      grade: 'رابع', section: 'ب', title: 'اختبار تجريبي للأسبوع',
      url: '222222', closeLabel: 'الخميس ظهراً', duration: '30 دقيقة', attempts: 'محاولة واحدة',
    });
    const text = buildWhatsAppBlurb(a, 'توقيع تجريبي');
    expect(text).toContain('اختبار تجريبي للأسبوع — رابع أ');
    expect(text).toContain('المدة: 30 دقيقة');
    expect(text).toContain('المحاولات: محاولة واحدة');
    expect(text).toContain('موعد الإغلاق: الخميس ظهراً');
    expect(text).toContain(a.url);
    expect(text).toContain('توقيع تجريبي');
    expect(text).not.toContain(b.url);
    expect(blurbMixesOtherSectionLink(text, a, [a, b])).toBe(false);
    expect(blurbMixesOtherSectionLink(`${text}\n${b.url}`, a, [a, b])).toBe(true);
  });
});
