import { Inject, Injectable } from '@nestjs/common';
import { app } from 'firebase-admin';
import { MESSAGE } from '../../common/message';

@Injectable()
export class FcmService {
  constructor(@Inject('FIREBASE_APP') private firebaseApp: app.App) {}

  async send(deviceToken: string, message: string) {
    const payload = {
      token: deviceToken,
      notification: {
        title: MESSAGE.NOTIFICATION.TITLE,
        body: message,
      },
    };
    const sendResult = await this.firebaseApp.messaging().send(payload);
  }
}
