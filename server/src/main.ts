import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonLogger } from './config/logger/winstonLogger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true }));
  app.useLogger(app.get(WinstonLogger));

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, () => {
    if (process.env.NODE_ENV == 'prod') process.send('ready');
  });
}
bootstrap();
