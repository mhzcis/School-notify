import { describe, expect, it } from 'vitest';
import { estimateCampaign, isGsm7, segmentInfo } from './sms';

describe('segmentInfo', () => {
  it('Arabic uses UCS-2: 70 in one part, 67 per part after', () => {
    expect(segmentInfo('ا'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1, remainingInPart: 0 });
    expect(segmentInfo('ا'.repeat(71))).toMatchObject({ segments: 2, remainingInPart: 63 });
    expect(segmentInfo('ا'.repeat(134)).segments).toBe(2);
    expect(segmentInfo('ا'.repeat(135)).segments).toBe(3);
  });

  it('plain Latin uses GSM-7: 160 / 153', () => {
    expect(isGsm7('Hello test 123')).toBe(true);
    expect(segmentInfo('a'.repeat(160)).segments).toBe(1);
    expect(segmentInfo('a'.repeat(161)).segments).toBe(2);
    expect(segmentInfo('a'.repeat(306)).segments).toBe(2);
    expect(segmentInfo('a'.repeat(307)).segments).toBe(3);
  });

  it('GSM extension chars count double; one Arabic char switches to UCS-2', () => {
    expect(segmentInfo('€'.repeat(80)).segments).toBe(1);
    expect(segmentInfo('€'.repeat(81)).segments).toBe(2);
    expect(segmentInfo('a'.repeat(100) + 'ب').encoding).toBe('UCS-2');
  });

  it('empty text has 0 segments', () => {
    expect(segmentInfo('').segments).toBe(0);
  });
});

describe('estimateCampaign', () => {
  it('sums segments and cost', () => {
    const e = estimateCampaign(['ا'.repeat(10), 'ا'.repeat(100)], 0.05);
    expect(e).toEqual({ messages: 2, totalSegments: 3, maxSegmentsPerMessage: 2, estimatedCost: 0.15 });
  });
  it('cost is null without a valid price', () => {
    expect(estimateCampaign(['x'], undefined).estimatedCost).toBeNull();
    expect(estimateCampaign(['x'], NaN).estimatedCost).toBeNull();
  });
});
