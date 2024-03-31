import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { find } from 'rxjs';

@Injectable()
export class RegularAlarmService {
  constructor(
    @InjectModel(RegularAlarm.name)
    private regularAlarmModel: Model<RegularAlarm>,
  ) {}

  async enrollAlarm(enrollRegularDto: EnrollRequestDto): Promise<RegularAlarm> {
    const newAlarm = new this.regularAlarmModel(enrollRegularDto);
    return newAlarm.save();
  }

  async deleteAlarm(deviceToken: string, alarmId: string) {
    const findAlarm = await this.regularAlarmModel.findOneAndDelete({
      _id: alarmId,
      deviceToken: deviceToken,
    });

    if (!findAlarm) {
      throw new BadRequestException('올바르지 않은 알람정보입니다.');
    }
  }

  async getAll(): Promise<RegularAlarm[]> {
    return this.regularAlarmModel.find();
  }
}
