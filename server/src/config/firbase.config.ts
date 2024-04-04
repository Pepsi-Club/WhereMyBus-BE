import * as admin from 'firebase-admin';
import { ConfigModule, ConfigService } from '@nestjs/config';

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
