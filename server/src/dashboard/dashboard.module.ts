import { Module } from '@nestjs/common';
import { BusApiMetricModule } from '../bus-api-metric/bus-api-metric.module';
import { DashboardAuthModule } from './auth/dashboard-auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardMetricService } from './dashboard-metric.service';

@Module({
  imports: [BusApiMetricModule, DashboardAuthModule],
  controllers: [DashboardController],
  providers: [DashboardMetricService],
})
export class DashboardModule {}
