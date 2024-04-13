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
import { BusInfoService } from '../../bus-info/bus-info.service';
import { FcmService } from '../../fcm/fcm.service';
import { Item } from '../../bus-info/arrival-info.type';

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
      providers: [RegularAlarmService, BusInfoService, FcmService],
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
    dto.arsId = '1234';
    dto.time = '0828';
    dto.busRouteId = '132412';
    dto.deviceToken = 'test';
    dto.day = [1, 2, 3];
    const result = await service.enrollAlarm(dto);
    expect(result.arsId).toBe('1234');
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
      arsId: '1234',
      time: '828',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [1, 2, 3],
    };

    const dto2 = {
      arsId: '1234',
      time: '82822',
      busRouteId: '132412',
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
      arsId: '1234',
      time: '0828',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [],
    };

    const dto2 = {
      arsId: '1234',
      time: '0828',
      busRouteId: '132412',
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

  it('현재 시간을 올바르게 포매팅할 수 있다.', () => {
    const midnight = new Date(1998, 11, 1, 0, 1);
    expect(service.timeString(midnight)).toBe('0001');

    const randomDate = new Date(1998, 11, 1, 18, 29);
    expect(service.timeString(randomDate)).toBe('1829');
  });

  it('현재 요일의 발송 정보만 조회할 수 있다.', async () => {
    const sunday = new Date('December 17, 1995 08:00:00');

    const weekday = {
      arsId: 'weekday',
      time: '0800',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [1, 2, 3, 4, 5],
    };

    const weekend = {
      arsId: 'weekend',
      time: '0800',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [0, 6],
    };
    await service.enrollAlarm(weekday);
    await service.enrollAlarm(weekend);

    const result = await service.getEnrolledRegularAlarm(
      service.timeString(sunday),
      sunday.getDay(),
    );
    expect(result.length).toBe(1);
    expect(result[0].arsId).toBe('weekend');
  });

  it('현재 시간의 발송 정보만 조회할 수 있다.', async () => {
    const sunday = new Date('December 17, 1995 03:24:00');

    const threeTwentyFour = {
      arsId: '222222',
      time: '0324',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
    };

    const eight = {
      arsId: '222222',
      time: '0800',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
    };
    await service.enrollAlarm(threeTwentyFour);
    await service.enrollAlarm(eight);

    const result = await service.getEnrolledRegularAlarm(
      service.timeString(sunday),
      sunday.getDay(),
    );
    expect(result.length).toBe(1);
    expect(result[0].time).toBe('0324');
  });

  it('해당 정류장에 존재하지 않는 버스 노선 정보로 등록된 정규알림 정보는 삭제된다.', async () => {
    const now = new Date('December 17, 1995 03:24:00');

    const wrong = {
      arsId: '22285',
      time: service.timeString(now),
      busRouteId: '1',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
    };

    const right = {
      arsId: '22285',
      time: service.timeString(now),
      busRouteId: '121900016',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
    };

    await service.enrollAlarm(wrong);
    await service.enrollAlarm(right);

    await service.sendNotification(service.timeString(now), now.getDay());

    const result = await service.getAll();
    expect(result.length).toBe(1);
  });

  it('버스 도착 정보를 올바르게 파싱하여 응답한다.', () => {
    const normal = '13분9초후[10번째 전]';
    const normal_result = service.parseMessage(normal);
    expect(normal_result).toBe('13분 9초후 도착합니다. (10번째 전)');

    const soon = '곧 도착';
    const soon_result = service.parseMessage(soon);
    expect(soon_result).toBe('버스가 곧 도착합니다.');
  });

  it('곧 도착인 버스는 다음 버스의 정보도 제공한다.', () => {
    const info: Pick<Item, 'arrmsg1' | 'arrmsg2'> = {
      arrmsg1: '곧 도착',
      arrmsg2: '13분9초후[10번째 전]',
    };
    const result = service.getMessageContent(info);
    expect(result).toBe(
      '버스가 곧 도착합니다.\n다음 버스가 13분 9초후 도착합니다. (10번째 전)',
    );
  });
});
