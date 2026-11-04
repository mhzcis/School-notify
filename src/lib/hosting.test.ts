import { describe, it, expect } from 'vitest';
import { gatewayBlockReason, CLOUD_NEEDS_PROXY_MESSAGE, LOCAL_HTTP_BLOCKED_MESSAGE, OTHER_GATEWAY_MESSAGE, CUSTOM_QUEUE_NEEDS_SERVER_MESSAGE } from './hosting';

describe('gatewayBlockReason', () => {
  it('blocks SMSGate cloud without a server proxy', () => {
    expect(gatewayBlockReason({ gatewayType: 'android_local', androidAppType: 'sms_gate_cloud' }, { proxyAvailable: false, pageProtocol: 'https:' })).toBe(CLOUD_NEEDS_PROXY_MESSAGE);
  });
  it('allows SMSGate cloud when a proxy exists', () => {
    expect(gatewayBlockReason({ gatewayType: 'android_local', androidAppType: 'sms_gate_cloud' }, { proxyAvailable: true, pageProtocol: 'https:' })).toBeNull();
  });
  it('blocks local http SMSGate from an https page', () => {
    expect(gatewayBlockReason({ gatewayType: 'android_local', androidAppType: 'sms_gate_app' }, { proxyAvailable: false, pageProtocol: 'https:' })).toBe(LOCAL_HTTP_BLOCKED_MESSAGE);
  });
  it('allows local SMSGate from an http page', () => {
    expect(gatewayBlockReason({ gatewayType: 'android_local', androidAppType: 'sms_gate_app' }, { proxyAvailable: false, pageProtocol: 'http:' })).toBeNull();
  });
  it('blocks other gateway types', () => {
    expect(gatewayBlockReason({ gatewayType: 'custom_api' }, { proxyAvailable: true, pageProtocol: 'http:' })).toBe(OTHER_GATEWAY_MESSAGE);
  });
  it('blocks the server-queue Android gateway without a server', () => {
    expect(gatewayBlockReason({ gatewayType: 'android_local', androidAppType: 'android_custom_gateway' }, { proxyAvailable: false, pageProtocol: 'http:' })).toBe(CUSTOM_QUEUE_NEEDS_SERVER_MESSAGE);
  });
});
