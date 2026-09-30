import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusApiMetric, BusApiMetricSchema } from './bus-api-metric.schema';
import { BusApiMetricRepository } from './bus-api-metric.repository';
import { BusApiMetricService } from './bus-api-metric.service';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardMetricService } from './dashboard-metric.service';
import { BusApiMetricController } from './bus-api-metric.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BusApiMetric.name, schema: BusApiMetricSchema },
    ]),
  ],
  controllers: [BusApiMetricController],
  providers: [
    BusApiMetricRepository,
    BusApiMetricService,
    DashboardAuthService,
    DashboardAuthGuard,
    DashboardMetricService,
  ],
  exports: [BusApiMetricRepository, BusApiMetricService],
})
export class BusApiMetricModule {}
