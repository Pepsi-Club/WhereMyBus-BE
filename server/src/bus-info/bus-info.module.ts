import { Module } from '@nestjs/common';
import { BusInfoService } from './bus-info.service';

@Module({
  providers: [BusInfoService],
  exports: [BusInfoService],
})
export class BusInfoModule {}
