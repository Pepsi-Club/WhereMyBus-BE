import { Test, TestingModule } from '@nestjs/testing';
import { BusInfoService } from './bus-info.service';
import { ConfigModule } from '@nestjs/config';

describe('BusInfoService', () => {
  let service: BusInfoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.dev',
        }),
      ],
      providers: [BusInfoService],
    }).compile();

    service = module.get<BusInfoService>(BusInfoService);
  });

  it('버스도착정보조회', async () => {
    const result = await service.arriveEachBus('22285', '121900016');
    console.log(result);
  });
});
