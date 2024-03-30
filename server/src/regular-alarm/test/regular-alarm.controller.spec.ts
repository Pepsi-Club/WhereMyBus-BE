import { Test, TestingModule } from '@nestjs/testing';
import { RegularAlarmController } from '../regular-alarm.controller';
import { RegularAlarmService } from '../regular-alarm.service';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { RegularAlarm, RegularAlarmSchema } from '../regular-alarm.schema';
import { EnrollRequestDto } from '../dto/request/enroll.request.dto';
import { BadRequestException } from '@nestjs/common';

describe('RegularAlarmController', () => {
  let controller: RegularAlarmController;

  beforeEach(async () => {
    const mongoServer = await MongoMemoryServer.create();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoServer.getUri()),
        MongooseModule.forFeature([
          { name: RegularAlarm.name, schema: RegularAlarmSchema },
        ]),
      ],
      controllers: [RegularAlarmController],
      providers: [RegularAlarmService],
    }).compile();

    controller = module.get<RegularAlarmController>(RegularAlarmController);
  });

  it('정규알람 등록시 시간은 4자리로 주어져야한다', () => {
    const dto = new EnrollRequestDto();
    dto.arsId = 1234;
    dto.time = '828';
    dto.busRouteId = 132412;
    dto.deviceToken = 'test';
    dto.activeDay = [1, 2, 3];
    expect(() => controller.enrollAlarm(dto)).toThrow(BadRequestException);
  });
});
