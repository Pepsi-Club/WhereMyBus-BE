import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';

@Injectable()
export class RegularAlarmRepository {
  constructor(
    @InjectModel(RegularAlarm.name)
    private regularAlarmModel: Model<RegularAlarm>,
  ) {}

  async saveAlarm(enrollRegularDto: EnrollRequestDto) {
    const invalidToken = await this.regularAlarmModel.exists({
      deviceToken: enrollRegularDto.deviceToken,
      isTokenInvalid: true,
    });
    const newAlarm = new this.regularAlarmModel({
      ...enrollRegularDto,
      isTokenInvalid: Boolean(invalidToken),
    });
    return newAlarm.save();
  }

  async findOneByIdAndTokenAndDelete(deviceToken: string, alarmId: string) {
    return this.regularAlarmModel.findOneAndDelete({
      _id: alarmId,
      deviceToken: deviceToken,
    });
  }

  async findByToken(deviceToken: string) {
    return this.regularAlarmModel.find({
      deviceToken,
      isTokenInvalid: { $ne: true },
    });
  }

  async findByTimeAndWeekDay(
    time: string,
    weekday: number,
  ): Promise<Array<RegularAlarm>> {
    return this.regularAlarmModel.find({
      time: time,
      day: weekday,
      isTokenInvalid: { $ne: true },
    });
  }

  async deleteAllById(id: string[]) {
    await this.regularAlarmModel.deleteMany({ _id: { $in: id } }).exec();
  }

  async markTokenInvalid(deviceToken: string): Promise<number> {
    const result = await this.regularAlarmModel
      .updateMany(
        { deviceToken, isTokenInvalid: { $ne: true } },
        { $set: { isTokenInvalid: true } },
      )
      .exec();
    return result.modifiedCount;
  }
}
