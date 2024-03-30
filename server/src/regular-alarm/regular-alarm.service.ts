import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';

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

  async getAll(): Promise<RegularAlarm[]> {
    return this.regularAlarmModel.find();
  }
}
