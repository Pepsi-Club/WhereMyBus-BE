import { ConfigModule, ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export const FirebaseProvider = {
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
