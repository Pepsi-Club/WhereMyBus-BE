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
    const newAlarm = new this.regularAlarmModel(enrollRegularDto);
    return newAlarm.save();
  }

  async findOneByIdAndTokenAndDelete(deviceToken: string, alarmId: string) {
    return this.regularAlarmModel.findOneAndDelete({
      _id: alarmId,
      deviceToken: deviceToken,
    });
  }

  async findByToken(deviceToken: string) {
    return this.regularAlarmModel.find({ deviceToken });
  }

  async findByTimeAndWeekDay(
    time: string,
    weekday: number,
  ): Promise<Array<RegularAlarm>> {
    return this.regularAlarmModel.find({
      time: time,
      day: weekday,
    });
  }

  async deleteAllById(id: string[]) {
    this.regularAlarmModel.deleteMany({ _id: { $in: id } });
  }
}
