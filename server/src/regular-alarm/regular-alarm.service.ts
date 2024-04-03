import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { find } from 'rxjs';
import { MESSAGE } from '../../common/message';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RegularAlarmService {
  private readonly serviceKey;
  private readonly apiUrl;
  constructor(
    @InjectModel(RegularAlarm.name)
    private regularAlarmModel: Model<RegularAlarm>,
    private configService: ConfigService,
  ) {
    this.serviceKey = this.configService.get<string>('SERVICE_KEY');
    this.apiUrl = this.configService.get<string>('BUS_INFO_API');
  }

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
      throw new BadRequestException(MESSAGE.EXCEPTION.ALARM_INFO_ERROR);
    }
  }

  async getAll(): Promise<RegularAlarm[]> {
    return this.regularAlarmModel.find();
  }

  async busArriveInfo(busRouteId: number, arsId: number): Promise<string> {
    const requestUrl = `${this.apiUrl}?ServiceKey=${this.serviceKey}&arsId=${arsId}&resultType=json`;
    const result = (await axios.get(requestUrl)).data;
    if (result.msgHeader.headerCd !== '0') {
      throw new Error('버스 도착 정보 조회 실패');
    }
    const infoList = result.msgBody.itemList;
    const info = infoList.filter((each) => each.busRouteId == busRouteId);
    return info[0].arrmsg1;
  }
}
