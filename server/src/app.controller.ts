import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import * as process from 'process';

type VersionObject = {
  ver: string;
};

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('minVer')
  minVer(): VersionObject {
    return { ver: '1.2.5' };
  }
}
