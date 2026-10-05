import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardLoginAttemptLimiter } from './dashboard-login-attempt-limiter';

@Module({
  imports: [ConfigModule],
  providers: [
    DashboardAuthService,
    DashboardAuthGuard,
    DashboardLoginAttemptLimiter,
  ],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class DashboardAuthModule {}
