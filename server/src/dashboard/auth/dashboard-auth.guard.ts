import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardAuthService,
} from './dashboard-auth.service';

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(private readonly authService: DashboardAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    this.authService.assertEnabled();
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.readCookie(
      request.headers.cookie,
      DASHBOARD_SESSION_COOKIE,
    );

    if (!token || !this.authService.verifySession(token)) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private readCookie(cookieHeader: string, name: string): string | null {
    if (!cookieHeader) {
      return null;
    }

    for (const pair of cookieHeader.split(';')) {
      const separator = pair.indexOf('=');
      if (separator < 0 || pair.slice(0, separator).trim() !== name) {
        continue;
      }
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      } catch (error) {
        return null;
      }
    }
    return null;
  }
}
