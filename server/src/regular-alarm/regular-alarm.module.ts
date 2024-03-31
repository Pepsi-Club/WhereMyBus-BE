import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RegularAlarm, RegularAlarmSchema } from './regular-alarm.schema';
import { RegularAlarmController } from './regular-alarm.controller';
import { RegularAlarmService } from './regular-alarm.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RegularAlarm.name, schema: RegularAlarmSchema },
    ]),
  ],
  controllers: [RegularAlarmController],
  providers: [RegularAlarmService],
})
export class RegularAlarmModule {}
