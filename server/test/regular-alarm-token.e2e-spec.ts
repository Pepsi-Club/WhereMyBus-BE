import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { BusInfoService } from '../src/bus-info/bus-info.service';
import { FcmService } from '../src/fcm/fcm.service';
import { RegularAlarmController } from '../src/regular-alarm/regular-alarm.controller';
import { RegularAlarmRepository } from '../src/regular-alarm/regular-alarm.repository';
import {
  RegularAlarm,
  RegularAlarmSchema,
} from '../src/regular-alarm/regular-alarm.schema';
import { RegularAlarmService } from '../src/regular-alarm/regular-alarm.service';
import {
  alarmFixture,
  arrivalFixture,
} from '../src/regular-alarm/testing/regular-alarm.fixture';

const sdkSend = jest.fn();
jest.mock('firebase-admin', () => ({
  credential: { applicationDefault: jest.fn() },
  initializeApp: jest.fn(() => ({ messaging: () => ({ send: sdkSend }) })),
}));

describe('RegularAlarm invalid token lifecycle (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let model: Model<RegularAlarm>;
  let service: RegularAlarmService;
  const bus = { arriveStation: jest.fn() };
  const alarm = alarmFixture({ day: [0, 1, 2, 3, 4, 5, 6] });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
    connection = await createConnection(mongo.getUri()).asPromise();
    model = connection.model(RegularAlarm.name, RegularAlarmSchema);
    const module = await Test.createTestingModule({
      controllers: [RegularAlarmController],
      providers: [
        RegularAlarmService,
        RegularAlarmRepository,
        FcmService,
        { provide: getModelToken(RegularAlarm.name), useValue: model },
        { provide: BusInfoService, useValue: bus },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    service = app.get(RegularAlarmService);
  });

  beforeEach(() => {
    sdkSend.mockReset().mockResolvedValue('message-id');
    bus.arriveStation.mockReset().mockResolvedValue(arrivalFixture());
    jest.spyOn(service, 'timeString').mockReturnValue('0828');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await model.deleteMany({});
  });
  afterAll(async () => {
    await app?.close();
    await connection?.close();
    await mongo?.stop();
  });

  it.each([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ])(
    '%s 후 모든 기존 토큰 알림을 보존하고 다음 cron과 목록에서 제외한다',
    async (code) => {
      for (const body of [alarm, alarm, { ...alarm, time: '1900', day: [6] }]) {
        await request(app.getHttpServer())
          .post('/regular')
          .send(body)
          .expect(201);
      }
      await request(app.getHttpServer())
        .post('/regular')
        .send({ ...alarm, deviceToken: 'token-b', arsId: 'other-station' })
        .expect(201);
      const before = await request(app.getHttpServer())
        .get('/regular')
        .query({ deviceToken: alarm.deviceToken })
        .expect(200);
      expect(before.body).toHaveLength(3);
      expect(Object.keys(before.body[0]).sort()).toEqual([
        'adirection',
        'arsId',
        'busRoutedId',
        'day',
        'id',
        'time',
      ]);
      sdkSend.mockImplementation(({ token }) =>
        token === alarm.deviceToken
          ? Promise.reject({ code })
          : Promise.resolve('id'),
      );

      await service.regularAlarm();

      expect(
        sdkSend.mock.calls.filter(
          ([payload]) => payload.token === alarm.deviceToken,
        ),
      ).toHaveLength(1);
      expect(
        await model.countDocuments({
          deviceToken: alarm.deviceToken,
          isTokenValid: false,
        }),
      ).toBe(3);
      expect(await model.countDocuments()).toBe(4);
      await request(app.getHttpServer())
        .get('/regular')
        .query({ deviceToken: alarm.deviceToken })
        .expect(200, []);
      sdkSend.mockClear();
      bus.arriveStation.mockClear();
      await service.regularAlarm();
      expect(bus.arriveStation.mock.calls).toEqual([['other-station']]);
      expect(sdkSend.mock.calls.map(([payload]) => payload.token)).toEqual([
        'token-b',
      ]);
    },
  );

  it.each([
    'messaging/invalid-argument',
    'messaging/server-unavailable',
    'messaging/authentication-error',
  ])('%s는 알림 상태를 변경하지 않는다', async (code) => {
    await request(app.getHttpServer()).post('/regular').send(alarm).expect(201);
    sdkSend.mockRejectedValue({ code });
    await service.regularAlarm();
    const response = await request(app.getHttpServer())
      .get('/regular')
      .query({ deviceToken: alarm.deviceToken })
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect(await model.countDocuments({ isTokenValid: false })).toBe(0);
  });

  it('상태 저장 실패 시 문서를 유지하고 다음 예약에서 다시 판정한다', async () => {
    await request(app.getHttpServer()).post('/regular').send(alarm).expect(201);
    sdkSend.mockRejectedValue({ code: 'messaging/invalid-registration-token' });
    jest
      .spyOn(model.collection, 'updateMany')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await service.regularAlarm();
    expect(await model.countDocuments({ isTokenValid: true })).toBe(1);
    await service.regularAlarm();
    expect(await model.countDocuments({ isTokenValid: false })).toBe(1);
    expect(sdkSend).toHaveBeenCalledTimes(2);
  });

  it('필드 없는 기존 문서는 앱 목록과 예약 발송에 포함한다', async () => {
    await model.collection.insertOne({ ...alarm, _id: new Types.ObjectId() });
    const response = await request(app.getHttpServer())
      .get('/regular')
      .query({ deviceToken: alarm.deviceToken })
      .expect(200);
    expect(response.body).toHaveLength(1);
    await service.regularAlarm();
    expect(sdkSend).toHaveBeenCalledTimes(1);
  });

  it('클라이언트는 무효 상태 필드를 직접 지정할 수 없다', async () => {
    await request(app.getHttpServer())
      .post('/regular')
      .send({ ...alarm, isTokenValid: true })
      .expect(400);
    expect(await model.countDocuments()).toBe(0);
  });

  it('같은 무효 토큰 재등록은 숨기고 새로운 토큰은 활성화한다', async () => {
    await model.create({ ...alarm, isTokenValid: false });
    await request(app.getHttpServer()).post('/regular').send(alarm).expect(201);
    await request(app.getHttpServer())
      .post('/regular')
      .send({ ...alarm, deviceToken: 'new-token' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/regular')
      .query({ deviceToken: alarm.deviceToken })
      .expect(200, []);
    const response = await request(app.getHttpServer())
      .get('/regular')
      .query({ deviceToken: 'new-token' })
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect(
      await model.countDocuments({
        deviceToken: alarm.deviceToken,
        isTokenValid: false,
      }),
    ).toBe(2);
  });

  it('무효 토큰 문서는 다른 기기가 삭제할 수 없고 본인 토큰으로 삭제할 수 있다', async () => {
    const saved = await model.create({ ...alarm, isTokenValid: false });
    await request(app.getHttpServer())
      .delete('/regular')
      .query({ deviceToken: 'other', alarmId: saved.id })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/regular')
      .query({ deviceToken: alarm.deviceToken, alarmId: saved.id })
      .expect(200);
    expect(await model.countDocuments()).toBe(0);
  });

  it.each([
    {
      scenario: '정상 코드의 빈 응답',
      headerCd: '0',
      empty: true,
      sendError: false,
    },
    {
      scenario: '오류 코드의 빈 응답',
      headerCd: '4',
      empty: true,
      sendError: false,
    },
    {
      scenario: '응답에 등록 노선 누락',
      headerCd: '0',
      empty: false,
      sendError: false,
    },
    {
      scenario: '빈 응답 및 안내 발송 실패',
      headerCd: '4',
      empty: true,
      sendError: true,
    },
  ])(
    '$scenario에서도 알림을 보존하고 응답 복구 후 다시 발송한다',
    async ({ headerCd, empty, sendError }) => {
      await request(app.getHttpServer())
        .post('/regular')
        .send(alarm)
        .expect(201);
      const before = await model.findOne().lean();
      const arrivals = arrivalFixture({ busRouteId: 'other-route' });
      arrivals.msgHeader.headerCd = headerCd;
      if (empty) {
        arrivals.msgBody.itemList = [];
        arrivals.msgHeader.itemCount = 0;
      }
      bus.arriveStation.mockResolvedValue(arrivals);
      if (sendError)
        sdkSend.mockRejectedValue({ code: 'messaging/server-unavailable' });

      await service.regularAlarm();

      expect(await model.findOne().lean()).toEqual(before);
      const listed = await request(app.getHttpServer())
        .get('/regular')
        .query({ deviceToken: alarm.deviceToken })
        .expect(200);
      expect(listed.body).toHaveLength(1);

      bus.arriveStation.mockResolvedValue(arrivalFixture());
      sdkSend.mockReset().mockResolvedValue('message-id');
      await service.regularAlarm();
      expect(sdkSend).toHaveBeenCalledTimes(1);
      expect(sdkSend).toHaveBeenCalledWith(
        expect.objectContaining({
          token: alarm.deviceToken,
          apns: expect.any(Object),
        }),
      );
    },
  );

  it('노선 오류 안내 중 무효 판정되면 해당 문서도 삭제 없이 보존한다', async () => {
    await model.create({ ...alarm, busRouteId: 'unknown' });
    sdkSend.mockRejectedValue({
      code: 'messaging/registration-token-not-registered',
    });
    await service.regularAlarm();
    expect(await model.countDocuments({ isTokenValid: false })).toBe(1);
    expect(await model.countDocuments()).toBe(1);
  });
});
