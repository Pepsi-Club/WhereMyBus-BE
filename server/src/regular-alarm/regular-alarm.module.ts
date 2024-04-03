import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RegularAlarm, RegularAlarmSchema } from './regular-alarm.schema';
import { RegularAlarmController } from './regular-alarm.controller';
import { RegularAlarmService } from './regular-alarm.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BusInfoModule } from '../bus-info/bus-info.module';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RegularAlarm.name, schema: RegularAlarmSchema },
    ]),
    ScheduleModule.forRoot(),
    BusInfoModule,
    FcmModule,
  ],
  controllers: [RegularAlarmController],
  providers: [RegularAlarmService],
})
export class RegularAlarmModule {}
