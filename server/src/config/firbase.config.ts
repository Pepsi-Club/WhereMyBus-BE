import * as admin from 'firebase-admin';

export const FirebaseProvider = {
  provide: 'FIREBASE_APP',
  useFactory: () => {
    return admin.initializeApp({
      credential: admin.credential.cert('firebase-adminsdk.json'),
    });
  },
};
