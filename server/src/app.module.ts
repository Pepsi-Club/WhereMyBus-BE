import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RegularAlarmModule } from './regular-alarm/regular-alarm.module';
import * as process from 'process';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseConfigService } from './config/mongoose.config';
import { FcmModule } from './fcm/fcm.module';
import { BusInfoModule } from './bus-info/bus-info.module';
import { LoggerMiddleware } from './config/logger/logger.middleware';
import { WinstonLogger } from './config/logger/winstonLogger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: process.env.NODE_ENV === 'dev' ? '.env.dev' : '.env.prod',
      isGlobal: true,
      cache: true,
    }),
    MongooseModule.forRootAsync({
      useClass: MongooseConfigService,
    }),
    RegularAlarmModule,
    FcmModule,
    BusInfoModule,
  ],
  controllers: [AppController],
  providers: [AppService, WinstonLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
