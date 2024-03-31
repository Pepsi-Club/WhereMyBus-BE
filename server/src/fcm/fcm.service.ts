import { Inject, Injectable } from '@nestjs/common';
import { app } from 'firebase-admin';

@Injectable()
export class FcmService {
  constructor(@Inject('FIREBASE_APP') private firebaseApp: app.App) {}

  async send(deviceToken: string, message: string) {
    const payload = {
      token: deviceToken,
      notification: {
        title: '버스어디',
        body: message,
      },
    };
    const sendResult = await this.firebaseApp.messaging().send(payload);
  }
}
