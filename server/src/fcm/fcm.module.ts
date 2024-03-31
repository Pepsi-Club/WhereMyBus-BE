import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

const FirebaseProvider = {
  provide: 'FIREBASE_APP',
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    return admin.initializeApp({
      credential: admin.credential.cert(
        configService.get<string>('FCM_CONFIG_PATH'),
      ),
    });
  },
};

@Module({
  providers: [FcmService, FirebaseProvider],
  controllers: [],
  exports: [FcmService],
})
export class FcmModule {}
