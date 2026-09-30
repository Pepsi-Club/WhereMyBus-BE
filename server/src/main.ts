import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonLogger } from './config/logger/winstonLogger.service';
import { INestApplication } from '@nestjs/common';

export async function configureApplication(
  app: INestApplication,
  configService: ConfigService,
): Promise<void> {
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true }));
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  const host = configService.get<string>('HOST', '127.0.0.1');
  await app.listen(port, host);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.useLogger(app.get(WinstonLogger));
  await configureApplication(app, configService);
}

if (require.main === module) {
  bootstrap();
}
