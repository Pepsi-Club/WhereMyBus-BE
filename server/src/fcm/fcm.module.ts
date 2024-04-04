import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';

@Module({
  providers: [FcmService],
  controllers: [],
  exports: [FcmService],
})
export class FcmModule {}
