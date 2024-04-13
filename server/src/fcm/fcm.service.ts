import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { app } from 'firebase-admin';
import { MESSAGE } from '../common/message';

@Injectable()
export class FcmService {
  private readonly firebaseApp: app.App;
  private logger = new Logger(FcmService.name);

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
    this.firebaseApp.messaging().send(payload);
  }

  async sendWithSubTitle(
    deviceToken: string,
    subTitle: string,
    message: string,
  ) {
    const payload = {
      token: deviceToken,
      notification: {
        title: MESSAGE.NOTIFICATION.TITLE,
        body: message,
      },
      data: {
        subTitle: subTitle,
      },
    };
    try {
      this.firebaseApp.messaging().send(payload);
    } catch (e) {
      console.log(e);
      this.logger.error(e);
    }
  }
}
