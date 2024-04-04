import { FcmService } from './fcm.service';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { FirebaseProvider } from '../config/firbase.config';

describe('FcmService', () => {
  let service: FcmService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.dev',
        }),
      ],
      providers: [FcmService, FirebaseProvider],
    }).compile();

    service = module.get<FcmService>(FcmService);
  });

  it('Fcm Notification Test', () => {
    const token = '';
    if (token) {
      service.send(token, '곧 도착');
    }
  });
});
