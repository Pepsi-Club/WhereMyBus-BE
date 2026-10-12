import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusInfoService } from '../bus-info/bus-info.service';
import { FcmService } from '../fcm/fcm.service';
import { RegularAlarmRepository } from './regular-alarm.repository';
import { RegularAlarmService } from './regular-alarm.service';
import {
  alarmFixture,
  arrivalFixture,
  deferred,
  observedRejection,
} from './testing/regular-alarm.fixture';

describe('RegularAlarm notification token lifecycle', () => {
  let service: RegularAlarmService;
  let fcm: { send: jest.Mock; sendWithSubTitle: jest.Mock };
  let repository: { markTokenInvalid: jest.Mock; deleteAllById: jest.Mock };
  let errorLog: jest.SpyInstance;
  const first = alarmFixture({ _id: 'alarm-1' });
  const second = alarmFixture({ _id: 'alarm-2' });
  const other = alarmFixture({ _id: 'alarm-3', deviceToken: 'token-b' });

  beforeEach(() => {
    fcm = {
      send: jest.fn().mockResolvedValue('id'),
      sendWithSubTitle: jest.fn().mockResolvedValue('id'),
    };
    repository = {
      markTokenInvalid: jest.fn().mockResolvedValue(2),
      deleteAllById: jest.fn().mockResolvedValue(undefined),
    };
    service = new RegularAlarmService(
      repository as unknown as RegularAlarmRepository,
      new ConfigService(),
      {
        arriveStation: jest.fn().mockResolvedValue(arrivalFixture()),
      } as unknown as BusInfoService,
      fcm as unknown as FcmService,
    );
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ])(
    '%s이면 같은 토큰의 후속 발송을 중단하고 다른 토큰은 계속한다',
    async (code) => {
      fcm.sendWithSubTitle.mockImplementation((token) =>
        token === 'token-a'
          ? observedRejection({ code })
          : Promise.resolve('id'),
      );
      await service.sendNotification([first, second, other]);
      expect(repository.markTokenInvalid).toHaveBeenCalledTimes(1);
      expect(repository.markTokenInvalid).toHaveBeenCalledWith('token-a');
      expect(fcm.sendWithSubTitle.mock.calls.map(([token]) => token)).toEqual([
        'token-a',
        'token-b',
      ]);
      expect(repository.deleteAllById.mock.calls.flat(2)).not.toContain(
        'alarm-1',
      );
    },
  );

  it.each([
    'messaging/invalid-argument',
    'messaging/server-unavailable',
    'messaging/internal-error',
    'messaging/message-rate-exceeded',
    'messaging/authentication-error',
    'ECONNRESET',
  ])('%s이면 상태를 유지하고 후속 발송을 계속한다', async (code) => {
    fcm.sendWithSubTitle.mockReturnValueOnce(observedRejection({ code }));
    await service.sendNotification([first, second, other]);
    expect(repository.markTokenInvalid).not.toHaveBeenCalled();
    expect(fcm.sendWithSubTitle).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalled();
  });

  it('상태 DB 갱신 실패도 다른 토큰 발송을 막지 않고 로그에 토큰을 노출하지 않는다', async () => {
    fcm.sendWithSubTitle.mockReturnValueOnce(
      observedRejection({
        code: 'messaging/registration-token-not-registered',
        message: 'secret-token',
      }),
    );
    repository.markTokenInvalid.mockReturnValue(
      observedRejection(new Error('secret-token database error')),
    );
    await expect(
      service.sendNotification([first, second, other]),
    ).resolves.toBeUndefined();
    expect(repository.markTokenInvalid).toHaveBeenCalledTimes(1);
    expect(fcm.sendWithSubTitle.mock.calls.map(([token]) => token)).toEqual([
      'token-a',
      'token-b',
    ]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('alarm-1'));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-token');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('token-a');
  });

  it('FCM 발송과 무효 상태 저장이 모두 끝날 때까지 반환하지 않는다', async () => {
    const sent = deferred<string>();
    const written = deferred<number>();
    const writeStarted = deferred<void>();
    fcm.sendWithSubTitle.mockReturnValueOnce(sent.promise);
    fcm.sendWithSubTitle.mockReturnValueOnce(
      observedRejection({ code: 'messaging/invalid-registration-token' }),
    );
    repository.markTokenInvalid.mockImplementation(() => {
      writeStarted.resolve();
      return written.promise;
    });
    let finished = false;
    const pending = service.sendNotification([first, second]).then(() => {
      finished = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(finished).toBe(false);
    expect(fcm.sendWithSubTitle).toHaveBeenCalledTimes(1);
    sent.resolve('id');
    await writeStarted.promise;
    expect(finished).toBe(false);
    written.resolve(2);
    await pending;
    expect(finished).toBe(true);
  });

  it('노선 오류 안내에서 무효 토큰을 발견하면 문서를 삭제하지 않는다', async () => {
    fcm.send.mockReturnValueOnce(
      observedRejection({ code: 'messaging/invalid-registration-token' }),
    );
    await service.sendNotification([
      alarmFixture({ _id: 'wrong', busRouteId: 'missing' }),
      second,
    ]);
    expect(repository.markTokenInvalid).toHaveBeenCalledWith('token-a');
    expect(fcm.sendWithSubTitle).not.toHaveBeenCalled();
    expect(repository.deleteAllById.mock.calls.flat(2)).not.toContain('wrong');
  });

  it('같은 토큰에서 뒤늦게 무효 판정되면 앞서 모은 노선 오류 문서도 보존한다', async () => {
    fcm.sendWithSubTitle.mockReturnValueOnce(
      observedRejection({ code: 'messaging/invalid-registration-token' }),
    );
    await service.sendNotification([
      alarmFixture({ _id: 'wrong', busRouteId: 'missing' }),
      second,
    ]);
    expect(repository.markTokenInvalid).toHaveBeenCalledWith('token-a');
    expect(repository.deleteAllById.mock.calls.flat(2)).not.toContain('wrong');
  });

  it('정상 토큰의 잘못된 노선만 삭제 대상으로 모으고 정상 알림은 유지한다', async () => {
    await service.sendNotification([
      alarmFixture({ _id: 'wrong', busRouteId: 'missing' }),
      other,
    ]);
    expect(repository.deleteAllById).toHaveBeenCalledWith(['wrong']);
    expect(repository.markTokenInvalid).not.toHaveBeenCalled();
    expect(fcm.sendWithSubTitle).toHaveBeenCalledWith(
      'token-b',
      '[100] 정류장',
      '버스가 3분 후 도착합니다. (2번째 전)',
    );
  });
});
