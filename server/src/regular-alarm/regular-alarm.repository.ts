import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';

const ACTIVE_TOKEN_FILTER = { isTokenValid: { $ne: false } };

@Injectable()
export class RegularAlarmRepository {
  constructor(
    @InjectModel(RegularAlarm.name)
    private readonly regularAlarmModel: Model<RegularAlarm>,
  ) {}

  async saveAlarm(enrollRegularDto: EnrollRequestDto) {
    const invalidTokenAlarm = await this.regularAlarmModel.exists({
      deviceToken: enrollRegularDto.deviceToken,
      isTokenValid: false,
    });
    const newAlarm = new this.regularAlarmModel({
      ...enrollRegularDto,
      isTokenValid: invalidTokenAlarm === null,
    });
    return newAlarm.save();
  }

  async findOneByIdAndTokenAndDelete(deviceToken: string, alarmId: string) {
    return this.regularAlarmModel.findOneAndDelete({
      _id: alarmId,
      deviceToken,
    });
  }

  async findByToken(deviceToken: string) {
    return this.regularAlarmModel.find({
      deviceToken,
      ...ACTIVE_TOKEN_FILTER,
    });
  }

  async findByTimeAndWeekDay(
    time: string,
    weekday: number,
  ): Promise<RegularAlarm[]> {
    return this.regularAlarmModel.find({
      time,
      day: weekday,
      ...ACTIVE_TOKEN_FILTER,
    });
  }

  async deleteActiveAlarmsById(alarmIds: string[]): Promise<void> {
    await this.regularAlarmModel
      .deleteMany({ _id: { $in: alarmIds }, ...ACTIVE_TOKEN_FILTER })
      .exec();
  }

  async markTokenInvalid(deviceToken: string): Promise<number> {
    const result = await this.regularAlarmModel
      .updateMany(
        { deviceToken, ...ACTIVE_TOKEN_FILTER },
        { $set: { isTokenValid: false } },
      )
      .exec();
    return result.modifiedCount;
  }
}
