import { Module } from '@nestjs/common';
import { BusInfoService } from './bus-info.service';
import { BusApiMetricModule } from '../bus-api-metric/bus-api-metric.module';

@Module({
  imports: [BusApiMetricModule],
  providers: [BusInfoService],
  exports: [BusInfoService],
})
export class BusInfoModule {}
