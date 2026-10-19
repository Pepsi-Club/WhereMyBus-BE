import { Test } from '@nestjs/testing';
import { RegularAlarmService } from './regular-alarm.service';
import { RegularAlarm, RegularAlarmSchema } from './regular-alarm.schema';
import { disconnect, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { BusInfoService } from '../bus-info/bus-info.service';
import { FcmService } from '../fcm/fcm.service';
import { RegularAlarmRepository } from './regular-alarm.repository';
import { arrivalFixture } from './testing/regular-alarm.fixture';

describe('RegularAlarmService', () => {
  let service: RegularAlarmService;
  let repository: RegularAlarmRepository;
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
      ],
      providers: [
        RegularAlarmService,
        {
          provide: BusInfoService,
          useValue: {
            arriveStation: jest
              .fn()
              .mockResolvedValue(
                arrivalFixture({ busRouteId: '121900016', adirection: null }),
              ),
          },
        },
        {
          provide: FcmService,
          useValue: {
            send: jest.fn().mockResolvedValue('id'),
            sendWithSubTitle: jest.fn().mockResolvedValue('id'),
          },
        },
        RegularAlarmRepository,
      ],
    }).compile();

    service = module.get<RegularAlarmService>(RegularAlarmService);
    repository = module.get<RegularAlarmRepository>(RegularAlarmRepository);
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
    dto.adirection = 'direction';
    const result = await service.enrollAlarm(dto);
    expect(result.arsId).toBe('1234');
  });

  it('알 수 없는 값으로 삭제하면 예외가 발생한다', async () => {
    await expect(
      service.deleteAlarm('test', '66083b42b0df3085dd413f2e'),
    ).rejects.toThrow(BadRequestException);
  });

  it('시간은 4자로 주어져야 한다.', async () => {
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
      adirection: '월암공영차고지',
    };

    const dto2 = {
      arsId: '1234',
      time: '82822',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [1, 2, 3],
      adirection: '월암공영차고지',
    };

    await expect(target.transform(dto1, metadata)).rejects.toThrow(
      BadRequestException,
    );

    await expect(target.transform(dto2, metadata)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('알람을 울릴 날짜는 1개 이상, 7개이하로 주어져야한다.', async () => {
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
      adirection: '월암공영차고지',
    };

    const dto2 = {
      arsId: '1234',
      time: '0828',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [1, 2, 3, 4, 5, 6, 7, 8],
      adirection: '월암공영차고지',
    };

    await expect(target.transform(dto1, metadata)).rejects.toThrow(
      BadRequestException,
    );

    await expect(target.transform(dto2, metadata)).rejects.toThrow(
      BadRequestException,
    );
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
      adirection: '월암공영차고지',
    };

    const weekend = {
      arsId: 'weekend',
      time: '0800',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [0, 6],
      adirection: '월암공영차고지',
    };
    await service.enrollAlarm(weekday);
    await service.enrollAlarm(weekend);

    const result = await repository.findByTimeAndWeekDay(
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
      adirection: '월암공영차고지',
    };

    const eight = {
      arsId: '222222',
      time: '0800',
      busRouteId: '132412',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
      adirection: '월암공영차고지',
    };
    await service.enrollAlarm(threeTwentyFour);
    await service.enrollAlarm(eight);

    const result = await repository.findByTimeAndWeekDay(
      service.timeString(sunday),
      sunday.getDay(),
    );
    expect(result.length).toBe(1);
    expect(result[0].time).toBe('0324');
  });

  it('응답에 노선이 없어도 기존 알림과 정상 알림을 모두 보존한다.', async () => {
    const now = new Date('December 17, 1995 03:24:00');

    const wrong = {
      arsId: '22285',
      time: service.timeString(now),
      busRouteId: '1',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
      adirection: '월암공영차고지',
    };

    const right = {
      arsId: '22285',
      time: service.timeString(now),
      busRouteId: '121900016',
      deviceToken: 'test',
      day: [0, 1, 2, 3, 4, 5, 6],
      adirection: '월암공영차고지',
    };
    const saved = await Promise.all([
      service.enrollAlarm(wrong),
      service.enrollAlarm(right),
    ]);
    await service.sendNotification(saved);
    const result = await service.getAlarmByToken('test');
    expect(result).toHaveLength(2);
    expect(result.map((alarm) => alarm.busRoutedId)).toEqual(
      expect.arrayContaining(['1', '121900016']),
    );
  });

  it('디바이스 토큰으로 저장된 정보를 조회할 수 있다.', async () => {
    const dto = new EnrollRequestDto();
    dto.arsId = '1234';
    dto.time = '0828';
    dto.busRouteId = '132412';
    dto.deviceToken = 'test';
    dto.day = [1, 2, 3];

    await service.enrollAlarm(dto);
    await service.enrollAlarm(dto);
    await service.enrollAlarm(dto);

    const response = await service.getAlarmByToken(dto.deviceToken);
    expect(response).toHaveLength(3);
  });

  it('올바르지 않은 디바이스토큰으로 조회하면 응답 정보를 조회할 수 없다.', async () => {
    const response = await service.getAlarmByToken('test');
    expect(response).toHaveLength(0);
  });
});
