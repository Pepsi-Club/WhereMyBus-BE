import { Connection, createConnection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { RegularAlarm, RegularAlarmSchema } from './regular-alarm.schema';
import { RegularAlarmRepository } from './regular-alarm.repository';

describe('RegularAlarmRepository token status', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let model: Model<RegularAlarm>;
  let repository: RegularAlarmRepository;
  const alarm = {
    deviceToken: 'old-token',
    time: '0828',
    day: [1],
    arsId: '22285',
    busRouteId: 'route',
    adirection: '종점',
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
    connection = await createConnection(mongo.getUri()).asPromise();
    model = connection.model(RegularAlarm.name, RegularAlarmSchema);
    repository = new RegularAlarmRepository(model);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await model.deleteMany({});
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  it('앱 목록과 스케줄 조회는 true 및 필드 없는 기존 문서만 포함한다', async () => {
    await model.collection.insertMany([
      { ...alarm },
      { ...alarm, isTokenValid: true },
      { ...alarm, isTokenValid: false },
    ]);
    expect(await repository.findByToken('old-token')).toHaveLength(2);
    expect(await repository.findByTimeAndWeekDay('0828', 1)).toHaveLength(2);
    expect(await repository.findByTimeAndWeekDay('0828', 2)).toHaveLength(0);
    expect(await repository.findByTimeAndWeekDay('0928', 1)).toHaveLength(0);
  });

  it('새로운 토큰을 true로 저장하고 내부 상태 입력은 무시한다', async () => {
    const saved = await repository.saveAlarm({
      ...alarm,
      isTokenValid: false,
    } as typeof alarm);
    expect(
      await model.collection.findOne({
        _id: new Types.ObjectId(String(saved._id)),
      }),
    ).toMatchObject({ isTokenValid: true });
  });

  it('이미 무효인 같은 토큰은 재등록해도 상태를 상속한다', async () => {
    await model.collection.insertOne({ ...alarm, isTokenValid: false });
    const saved = await repository.saveAlarm(alarm);
    expect(
      await model.collection.findOne({
        _id: new Types.ObjectId(String(saved._id)),
      }),
    ).toMatchObject({ isTokenValid: false });
    expect(await repository.findByToken(alarm.deviceToken)).toEqual([]);
  });

  it('사용자는 무효 알림도 token과 id가 일치하면 삭제할 수 있다', async () => {
    const { insertedId } = await model.collection.insertOne({
      ...alarm,
      isTokenValid: false,
    });
    expect(
      await repository.findOneByIdAndTokenAndDelete(
        'other',
        String(insertedId),
      ),
    ).toBeNull();
    await repository.findOneByIdAndTokenAndDelete(
      alarm.deviceToken,
      String(insertedId),
    );
    expect(await model.exists({ _id: String(insertedId) })).toBeNull();
  });

  it('무효 토큰의 모든 시간·요일 문서를 갱신하고 다른 토큰은 보존한다', async () => {
    await model.collection.insertMany([
      { ...alarm },
      { ...alarm, time: '1900', day: [6], isTokenValid: true },
      { ...alarm, isTokenValid: false },
      { ...alarm, deviceToken: 'other', isTokenValid: true },
    ]);
    expect(await repository.markTokenInvalid(alarm.deviceToken)).toBe(2);
    expect(
      await model.countDocuments({
        deviceToken: alarm.deviceToken,
        isTokenValid: false,
      }),
    ).toBe(3);
    expect(await repository.findByToken('other')).toHaveLength(1);
    expect(await repository.findByToken(alarm.deviceToken)).toEqual([]);
    expect(await repository.findByTimeAndWeekDay('1900', 6)).toEqual([]);
    expect(await repository.markTokenInvalid(alarm.deviceToken)).toBe(0);
    expect(await repository.markTokenInvalid('unknown')).toBe(0);
  });

  it('상태 저장 실패를 성공으로 처리하지 않는다', async () => {
    const failure = new Error('database unavailable');
    jest.spyOn(model.collection, 'updateMany').mockRejectedValueOnce(failure);
    await expect(repository.markTokenInvalid(alarm.deviceToken)).rejects.toBe(
      failure,
    );
  });

  it('사용자의 명시적 알림 삭제 실패를 호출자에게 전달한다', async () => {
    const failure = new Error('database unavailable');
    jest
      .spyOn(model.collection, 'findOneAndDelete')
      .mockRejectedValueOnce(failure);
    await expect(
      repository.findOneByIdAndTokenAndDelete(
        'old-token',
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBe(failure);
  });
});
