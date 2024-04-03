import { Test } from '@nestjs/testing';
import { RegularAlarmService } from '../regular-alarm.service';
import { RegularAlarm, RegularAlarmSchema } from '../regular-alarm.schema';
import { disconnect, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { EnrollRequestDto } from '../dto/request/enroll.request.dto';
import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

describe('RegularAlarmService', () => {
  let service: RegularAlarmService;
  let mongoServer: MongoMemoryServer;
  let regularAlarmModel: Model<RegularAlarm>;
  let target: ValidationPipe;

  beforeAll(async () => {
    target = new ValidationPipe();
    mongoServer = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoServer.getUri()),
        MongooseModule.forFeature([
          { name: RegularAlarm.name, schema: RegularAlarmSchema },
        ]),
        ConfigModule.forRoot({
          envFilePath: '.env.dev',
        }),
      ],
      providers: [RegularAlarmService],
    }).compile();

    service = module.get<RegularAlarmService>(RegularAlarmService);
    regularAlarmModel = module.get<Model<RegularAlarm>>(
      getModelToken(RegularAlarm.name),
    );
  });

  afterEach(async () => {
    await regularAlarmModel.deleteMany({});
  });

  afterAll(async () => {
    await disconnect();
    await mongoServer.stop();
  });

  it('정규알람을 저장할 수 있다.', async () => {
    const dto = new EnrollRequestDto();
    dto.arsId = 1234;
    dto.time = '0828';
    dto.busRouteId = 132412;
    dto.deviceToken = 'test';
    dto.day = [1, 2, 3];
    const result = await service.enrollAlarm(dto);
    expect(result.arsId).toBe(1234);
  });

  it('알 수 없는 값으로 삭제하면 예외가 발생한다', () => {
    expect(async () => {
      const dto = new EnrollRequestDto();
      await service.deleteAlarm('test', '66083b42b0df3085dd413f2e');
    }).rejects.toThrow(BadRequestException);
  });

  it('시간은 4자로 주어져야 한다.', () => {
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: EnrollRequestDto,
      data: '',
    };

    const dto1 = {
      arsId: 1234,
      time: '828',
      busRouteId: 132412,
      deviceToken: 'test',
      day: [1, 2, 3],
    };

    const dto2 = {
      arsId: 1234,
      time: '82822',
      busRouteId: 132412,
      deviceToken: 'test',
      day: [1, 2, 3],
    };

    expect(async () => {
      await target.transform(<EnrollRequestDto>dto1, metadata);
    }).rejects.toThrow(BadRequestException);

    expect(async () => {
      await target.transform(<EnrollRequestDto>dto2, metadata);
    }).rejects.toThrow(BadRequestException);
  });

  it('알람을 울릴 날짜는 1개 이상, 7개이하로 주어져야한다.', () => {
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: EnrollRequestDto,
      data: '',
    };

    const dto1 = {
      arsId: 1234,
      time: '0828',
      busRouteId: 132412,
      deviceToken: 'test',
      day: [],
    };

    const dto2 = {
      arsId: 1234,
      time: '0828',
      busRouteId: 132412,
      deviceToken: 'test',
      day: [1, 2, 3, 4, 5, 6, 7, 8],
    };

    expect(async () => {
      await target.transform(<EnrollRequestDto>dto1, metadata);
    }).rejects.toThrow(BadRequestException);

    expect(async () => {
      await target.transform(<EnrollRequestDto>dto2, metadata);
    }).rejects.toThrow(BadRequestException);
  });

  it('버스도착정보조회', async () => {
    const result = await service.busArriveInfo(121900016, 22285);
    console.log(result);
  });
});
