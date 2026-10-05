import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusApiMetric, BusApiMetricSchema } from './bus-api-metric.schema';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import { BusApiMetricService } from './bus-api-metric.service';
import { DashboardAuthModule } from '../dashboard/auth/dashboard-auth.module';
import { DashboardMetricService } from './dashboard-metric.service';
import { BusApiMetricController } from './bus-api-metric.controller';

@Module({
  imports: [
    DashboardAuthModule,
    MongooseModule.forFeature([
      { name: BusApiMetric.name, schema: BusApiMetricSchema },
    ]),
  ],
  controllers: [BusApiMetricController],
  providers: [
    BusApiMetricRepository,
    BusApiMetricService,
    DashboardMetricService,
  ],
  exports: [BusApiMetricRepository, BusApiMetricService],
})
export class BusApiMetricModule {}
