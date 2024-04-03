import { Module } from '@nestjs/common';
import { BusInfoService } from './bus-info.service';

@Module({
  providers: [BusInfoService],
})
export class BusInfoModule {}
