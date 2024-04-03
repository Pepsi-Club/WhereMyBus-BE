import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { FirebaseProvider } from '../config/firbase.config';

@Module({
  providers: [FcmService, FirebaseProvider],
  controllers: [],
  exports: [FcmService],
})
export class FcmModule {}
