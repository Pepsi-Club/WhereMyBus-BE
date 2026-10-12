import { FcmService } from './fcm.service';
import { MESSAGE } from '../common/message';

const sdkSend = jest.fn();
jest.mock('firebase-admin', () => ({
  credential: { applicationDefault: jest.fn() },
  initializeApp: jest.fn(() => ({ messaging: () => ({ send: sdkSend }) })),
}));

describe('FcmService', () => {
  let service: FcmService;

  beforeEach(() => {
    sdkSend.mockReset();
    service = new FcmService();
  });

  const methods = ['send', 'sendWithSubTitle'] as const;
  const send = (method: (typeof methods)[number]) =>
    method === 'send'
      ? service.send('token', '본문')
      : service.sendWithSubTitle('token', '부제', '본문');

  it.each(methods)('%s는 SDK의 message ID를 반환한다', async (method) => {
    sdkSend.mockResolvedValue('message-id');
    await expect(send(method)).resolves.toBe('message-id');
  });

  it.each(methods)(
    '%s는 비동기 발송 실패를 호출자에게 전달한다',
    async (method) => {
      const failure = { code: 'messaging/registration-token-not-registered' };
      const rejected = Promise.reject(failure);
      // Observe the SDK rejection even while testing the old fire-and-forget implementation.
      rejected.catch(() => undefined);
      sdkSend.mockReturnValue(rejected);
      await expect(send(method)).rejects.toBe(failure);
    },
  );

  it.each(methods)('%s는 SDK 발송이 끝날 때까지 대기한다', async (method) => {
    let finish: (id: string) => void;
    sdkSend.mockReturnValue(
      new Promise<string>((resolve) => (finish = resolve)),
    );
    let settled = false;
    const pending = send(method).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish('message-id');
    await pending;
    expect(settled).toBe(true);
  });

  it('기존 일반 알림과 APNs 부제 payload를 유지한다', async () => {
    sdkSend.mockResolvedValue('message-id');
    await service.send('token', '본문');
    await service.sendWithSubTitle('token', '부제', '본문');
    expect(sdkSend.mock.calls).toEqual([
      [
        {
          token: 'token',
          notification: { title: MESSAGE.NOTIFICATION.TITLE, body: '본문' },
        },
      ],
      [
        {
          token: 'token',
          apns: {
            payload: {
              aps: {
                alert: {
                  title: MESSAGE.NOTIFICATION.TITLE,
                  body: '본문',
                  subtitle: '부제',
                },
              },
            },
          },
        },
      ],
    ]);
  });
});
