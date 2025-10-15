import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { MESSAGE } from '../common/message';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusInfoService } from '../bus-info/bus-info.service';
import { FcmService } from '../fcm/fcm.service';
import { Item, ResponseData } from '../bus-info/arrival-info.type';
import { GetByTokenResponseDto } from './dto/response/getByToken.response.dto';
import { RegularAlarmRepository } from './regular-alarm.repository';
import { MessageUtil } from './MessageUtil';
@Injectable()
export class RegularAlarmService {
  private readonly serviceKey;
  private readonly apiUrl;
  private logger = new Logger(RegularAlarmService.name);
  private busArrivalMessageRegex = /(\d+)\s*분(?:후)?(?:.*?(\d+)번째 전)?/;

  constructor(
    private regularAlarmRepository: RegularAlarmRepository,
    private configService: ConfigService,
    private busInfoService: BusInfoService,
    private fcmService: FcmService,
  ) {
    this.serviceKey = this.configService.get<string>('SERVICE_KEY');
    this.apiUrl = this.configService.get<string>('BUS_INFO_API');
  }

  async enrollAlarm(enrollRegularDto: EnrollRequestDto): Promise<RegularAlarm> {
    return this.regularAlarmRepository.saveAlarm(enrollRegularDto);
  }

  async deleteAlarm(deviceToken: string, alarmId: string) {
    const findAlarm =
      await this.regularAlarmRepository.findOneByIdAndTokenAndDelete(
        deviceToken,
        alarmId,
      );
    if (!findAlarm) {
      throw new BadRequestException(MESSAGE.EXCEPTION.ALARM_INFO_ERROR);
    }
  }

  async getAlarmByToken(deviceToken: string): Promise<GetByTokenResponseDto[]> {
    const savedAlarms = await this.regularAlarmRepository.findByToken(
      deviceToken,
    );
    return savedAlarms.map((each) => new GetByTokenResponseDto(each));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async regularAlarm() {
    const now = new Date();
    const time = this.timeString(now);
    const day = now.getDay();
    this.logger.log(`${time}, ${day} - regularAlarm`);

    const infos: Array<RegularAlarm> =
      await this.regularAlarmRepository.findByTimeAndWeekDay(time, day);
    this.logger.log(`${infos.length} regular alarm founded`);

    await this.sendNotification(infos);
  }

  async sendNotification(infos: Array<RegularAlarm>) {
    const stationArrivalInfoMap: Map<string, ResponseData> =
      await this.getStationArrivalInfoMap(infos);

    const wrongData = [];

    infos.forEach((info) => {
      const busInfo: Item[] = stationArrivalInfoMap
        .get(info.arsId)
        .msgBody.itemList.filter(
          (item) =>
            item.busRouteId === info.busRouteId &&
            (item.adirection === null || item.adirection === info.adirection),
        );
      if (busInfo.length > 0) {
        const { subTitle, message } = MessageUtil.getMessageContent(busInfo[0]);

        try {
          this.fcmService.sendWithSubTitle(info.deviceToken, subTitle, message);
        } catch (e) {
          this.logger.error(e);
        }
      } else {
        this.fcmService.send(info.deviceToken, MESSAGE.NOTIFICATION.ERROR);
        wrongData.push(info._id);
      }
    });

    await this.regularAlarmRepository.deleteAllById(wrongData);
  }

  async getStationArrivalInfoMap(infos): Promise<Map<string, ResponseData>> {
    const stationArrivalInfoMap: Map<string, ResponseData> = new Map();
    for (const info of infos) {
      const stationId = info.arsId;

      if (!stationArrivalInfoMap.has(stationId)) {
        const result = await this.busInfoService.arriveStation(info.arsId);
        stationArrivalInfoMap.set(stationId, result);
      }
    }
    return stationArrivalInfoMap;
  }

  timeString(now: Date) {
    return (
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0')
    );
  }
}
