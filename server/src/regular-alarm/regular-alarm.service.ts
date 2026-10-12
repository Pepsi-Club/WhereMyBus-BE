import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { MESSAGE } from '../common/message';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusInfoService } from '../bus-info/bus-info.service';
import { FcmService } from '../fcm/fcm.service';
import { ResponseData } from '../bus-info/arrival-info.type';
import { GetByTokenResponseDto } from './dto/response/getByToken.response.dto';
import { RegularAlarmRepository } from './regular-alarm.repository';
import { MessageUtil } from './MessageUtil';
import { isInvalidFcmTokenError } from '../fcm/fcm-error';
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

    const alarmsByToken = new Map<string, RegularAlarm[]>();
    for (const info of infos) {
      const group = alarmsByToken.get(info.deviceToken) ?? [];
      group.push(info);
      alarmsByToken.set(info.deviceToken, group);
    }
    const groups = [...alarmsByToken.values()];
    const results = await Promise.allSettled(
      groups.map((group) =>
        this.sendTokenNotifications(group, stationArrivalInfoMap),
      ),
    );
    const wrongData: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        wrongData.push(...result.value);
      } else {
        this.logger.error(
          `Failed to process alarm group; alarmId=${groups[index][0]._id}`,
        );
      }
    });
    await this.regularAlarmRepository.deleteAllById(wrongData);
  }

  private async sendTokenNotifications(
    infos: RegularAlarm[],
    arrivals: Map<string, ResponseData>,
  ): Promise<string[]> {
    const wrongData: string[] = [];
    for (const info of infos) {
      const busInfo = arrivals
        .get(info.arsId)
        .msgBody.itemList.find(
          (item) =>
            item.busRouteId === info.busRouteId &&
            (item.adirection === null || item.adirection === info.adirection),
        );
      const content = busInfo ? MessageUtil.getMessageContent(busInfo) : null;
      try {
        if (content) {
          await this.fcmService.sendWithSubTitle(
            info.deviceToken,
            content.subTitle,
            content.message,
          );
        } else {
          await this.fcmService.send(
            info.deviceToken,
            MESSAGE.NOTIFICATION.ERROR,
          );
        }
      } catch (error) {
        if (isInvalidFcmTokenError(error)) {
          await this.invalidateToken(info);
          return [];
        }
        this.logger.error(`FCM send failed; alarmId=${info._id}`);
      }
      if (!busInfo) wrongData.push(info._id);
    }
    return wrongData;
  }

  private async invalidateToken(info: RegularAlarm): Promise<void> {
    try {
      const updated = await this.regularAlarmRepository.markTokenInvalid(
        info.deviceToken,
      );
      this.logger.warn(
        `Invalid FCM token; alarmId=${info._id}; updated=${updated}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist invalid token state; alarmId=${info._id}`,
      );
    }
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
