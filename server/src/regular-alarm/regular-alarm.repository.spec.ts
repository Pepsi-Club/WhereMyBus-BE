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

  it('앱 목록과 스케줄 조회는 false 및 필드 없는 기존 문서만 포함한다', async () => {
    await model.collection.insertMany([
      { ...alarm },
      { ...alarm, isTokenInvalid: false },
      { ...alarm, isTokenInvalid: true },
    ]);
    expect(await repository.findByToken('old-token')).toHaveLength(2);
    expect(await repository.findByTimeAndWeekDay('0828', 1)).toHaveLength(2);
    expect(await repository.findByTimeAndWeekDay('0828', 2)).toHaveLength(0);
    expect(await repository.findByTimeAndWeekDay('0928', 1)).toHaveLength(0);
  });

  it('새로운 토큰을 false로 저장하고 내부 상태 입력은 무시한다', async () => {
    const saved = await repository.saveAlarm({
      ...alarm,
      isTokenInvalid: true,
    } as typeof alarm);
    expect(
      await model.collection.findOne({
        _id: new Types.ObjectId(String(saved._id)),
      }),
    ).toMatchObject({ isTokenInvalid: false });
  });

  it('이미 무효인 같은 토큰은 재등록해도 상태를 상속한다', async () => {
    await model.collection.insertOne({ ...alarm, isTokenInvalid: true });
    const saved = await repository.saveAlarm(alarm);
    expect(
      await model.collection.findOne({
        _id: new Types.ObjectId(String(saved._id)),
      }),
    ).toMatchObject({ isTokenInvalid: true });
    expect(await repository.findByToken(alarm.deviceToken)).toEqual([]);
  });

  it('deleteAllById는 지정한 문서를 실제로 삭제하고 완료까지 기다린다', async () => {
    const removed = await model.create(alarm);
    const retained = await model.create({ ...alarm, deviceToken: 'other' });
    await repository.deleteAllById([String(removed._id)]);
    expect(await model.exists({ _id: removed._id })).toBeNull();
    expect(await model.exists({ _id: retained._id })).not.toBeNull();
  });

  it('사용자는 무효 알림도 token과 id가 일치하면 삭제할 수 있다', async () => {
    const { insertedId } = await model.collection.insertOne({
      ...alarm,
      isTokenInvalid: true,
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

  it('자동 정리 후보 수집 후 무효화된 문서는 보존하고 나머지 활성 문서만 삭제한다', async () => {
    await model.collection.insertMany([
      { ...alarm },
      { ...alarm, deviceToken: 'legacy-active' },
      { ...alarm, deviceToken: 'new-active', isTokenInvalid: false },
    ]);
    const candidates = await repository.findByTimeAndWeekDay('0828', 1);
    await repository.markTokenInvalid(alarm.deviceToken);

    await repository.deleteAllById(candidates.map((item) => String(item._id)));

    expect(await model.countDocuments()).toBe(1);
    expect(
      await model.findOne({ deviceToken: alarm.deviceToken }),
    ).toMatchObject({
      isTokenInvalid: true,
    });
  });

  it('무효 토큰의 모든 시간·요일 문서를 갱신하고 다른 토큰은 보존한다', async () => {
    await model.collection.insertMany([
      { ...alarm },
      { ...alarm, time: '1900', day: [6], isTokenInvalid: false },
      { ...alarm, isTokenInvalid: true },
      { ...alarm, deviceToken: 'other', isTokenInvalid: false },
    ]);
    expect(await repository.markTokenInvalid(alarm.deviceToken)).toBe(2);
    expect(
      await model.countDocuments({
        deviceToken: alarm.deviceToken,
        isTokenInvalid: true,
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

  it('알림 삭제 실패를 호출자에게 전달한다', async () => {
    const failure = new Error('database unavailable');
    jest.spyOn(model.collection, 'deleteMany').mockRejectedValueOnce(failure);
    await expect(
      repository.deleteAllById([new Types.ObjectId().toString()]),
    ).rejects.toBe(failure);
  });
});
