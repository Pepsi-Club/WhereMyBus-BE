import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { app } from 'firebase-admin';
import { MESSAGE } from '../common/message';

@Injectable()
export class FcmService {
  private readonly firebaseApp: app.App;

  constructor() {
    this.firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  async send(deviceToken: string, message: string): Promise<string> {
    const payload = {
      token: deviceToken,
      notification: {
        title: MESSAGE.NOTIFICATION.TITLE,
        body: message,
      },
    };
    return this.firebaseApp.messaging().send(payload);
  }

  async sendWithSubTitle(
    deviceToken: string,
    subTitle: string,
    message: string,
  ): Promise<string> {
    const payload = {
      token: deviceToken,
      apns: {
        payload: {
          aps: {
            alert: {
              title: MESSAGE.NOTIFICATION.TITLE,
              body: message,
              subtitle: subTitle,
            },
          },
        },
      },
    };
    return this.firebaseApp.messaging().send(payload);
  }
}
