import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusApiMetric, BusApiMetricSchema } from './bus-api-metric.schema';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import { BusApiMetricService } from './bus-api-metric.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BusApiMetric.name, schema: BusApiMetricSchema },
    ]),
  ],
  providers: [BusApiMetricRepository, BusApiMetricService],
  exports: [BusApiMetricRepository, BusApiMetricService],
})
export class BusApiMetricModule {}
