import { isInvalidFcmTokenError } from './fcm-error';

describe('isInvalidFcmTokenError', () => {
  it.each([
    ['messaging/registration-token-not-registered', true],
    ['messaging/invalid-registration-token', true],
    ['messaging/invalid-argument', false],
    ['messaging/server-unavailable', false],
    ['messaging/internal-error', false],
    ['messaging/message-rate-exceeded', false],
    ['messaging/authentication-error', false],
    ['messaging/third-party-auth-error', false],
    ['messaging/mismatched-credential', false],
    ['ECONNRESET', false],
  ])('%s의 무효 판정은 %s다', (code, invalid) => {
    expect(isInvalidFcmTokenError({ code })).toBe(invalid);
  });

  it.each([
    null,
    undefined,
    'messaging/invalid-registration-token',
    {},
    { status: 404 },
    { code: 404 },
    { message: 'messaging/registration-token-not-registered' },
  ])('명확한 error.code가 없는 %j는 무효 판정하지 않는다', (error) => {
    expect(isInvalidFcmTokenError(error)).toBe(false);
  });
});
