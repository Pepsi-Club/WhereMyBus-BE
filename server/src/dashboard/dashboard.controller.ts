import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { DashboardAuthGuard } from './auth/dashboard-auth.guard';
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthService,
} from './auth/dashboard-auth.service';
import { DashboardMetricService } from './dashboard-metric.service';
import { DashboardAuthRequestDto } from './auth/dto/dashboard-auth.request.dto';
import { DashboardMetricQueryDto } from './dto/dashboard-metric.query.dto';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly authService: DashboardAuthService,
    private readonly metricService: DashboardMetricService,
  ) {}

  @Post('auth')
  auth(
    @Body() body: DashboardAuthRequestDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
  ): { authenticated: true } {
    this.authService.authenticate(body.code, ip);
    response.cookie(
      DASHBOARD_SESSION_COOKIE,
      this.authService.createSession(),
      this.cookieOptions(this.authService.sessionTtlSeconds * 1000),
    );
    return { authenticated: true };
  }

  @UseGuards(DashboardAuthGuard)
  @Get('session')
  session(): { authenticated: true } {
    return { authenticated: true };
  }

  @UseGuards(DashboardAuthGuard)
  @Get('metric-dimensions')
  metricDimensions() {
    return this.metricService.getDimensions();
  }

  @UseGuards(DashboardAuthGuard)
  @Get('metrics')
  metrics(@Query() query: DashboardMetricQueryDto) {
    return this.metricService.getMetrics(query.range, {
      providers: query.providers,
      operations: query.operations,
    });
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response): {
    authenticated: false;
  } {
    response.cookie(DASHBOARD_SESSION_COOKIE, '', this.cookieOptions(0));
    return { authenticated: false };
  }

  private cookieOptions(maxAge: number) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'strict' as const,
      path: '/api/dashboard',
      maxAge,
    };
  }
}
