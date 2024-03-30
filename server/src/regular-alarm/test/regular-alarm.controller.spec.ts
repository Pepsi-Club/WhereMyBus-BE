import { Test, TestingModule } from '@nestjs/testing';
import { RegularAlarmController } from '../regular-alarm.controller';

describe('RegularAlarmController', () => {
  let controller: RegularAlarmController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegularAlarmController],
    }).compile();

    controller = module.get<RegularAlarmController>(RegularAlarmController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
