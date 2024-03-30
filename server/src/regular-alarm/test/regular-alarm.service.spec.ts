import { Test, TestingModule } from '@nestjs/testing';
import { RegularAlarmService } from '../regular-alarm.service';

describe('RegularAlarmService', () => {
  let service: RegularAlarmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RegularAlarmService],
    }).compile();

    service = module.get<RegularAlarmService>(RegularAlarmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
