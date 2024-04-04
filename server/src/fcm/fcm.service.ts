import { Injectable } from '@nestjs/common';
import { app } from 'firebase-admin';
import { MESSAGE } from '../../common/message';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService {
  private readonly firebaseApp: app.App;
  constructor() {
    this.firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

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
