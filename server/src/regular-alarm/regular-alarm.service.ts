import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RegularAlarm } from './regular-alarm.schema';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { MESSAGE } from '../common/message';
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
  private readonly logger = new Logger(RegularAlarmService.name);

  constructor(
    private readonly regularAlarmRepository: RegularAlarmRepository,
    private readonly busInfoService: BusInfoService,
    private readonly fcmService: FcmService,
  ) {}

  async enrollAlarm(enrollRegularDto: EnrollRequestDto): Promise<RegularAlarm> {
    return this.regularAlarmRepository.saveAlarm(enrollRegularDto);
  }

  async deleteAlarm(deviceToken: string, alarmId: string) {
    const deletedAlarm =
      await this.regularAlarmRepository.findOneByIdAndTokenAndDelete(
        deviceToken,
        alarmId,
      );
    if (!deletedAlarm) {
      throw new BadRequestException(MESSAGE.EXCEPTION.ALARM_INFO_ERROR);
    }
  }

  async getAlarmByToken(deviceToken: string): Promise<GetByTokenResponseDto[]> {
    const savedAlarms = await this.regularAlarmRepository.findByToken(
      deviceToken,
    );
    return savedAlarms.map((alarm) => new GetByTokenResponseDto(alarm));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async regularAlarm() {
    const now = new Date();
    const time = this.timeString(now);
    const day = now.getDay();
    this.logger.log(`${time}, ${day} - regularAlarm`);

    const alarms = await this.regularAlarmRepository.findByTimeAndWeekDay(
      time,
      day,
    );
    this.logger.log(`${alarms.length} regular alarm founded`);

    await this.sendNotification(alarms);
  }

  async sendNotification(alarms: RegularAlarm[]): Promise<void> {
    const stationArrivalInfoMap = await this.getStationArrivalInfoMap(alarms);

    const alarmsByToken = new Map<string, RegularAlarm[]>();
    for (const alarm of alarms) {
      const group = alarmsByToken.get(alarm.deviceToken) ?? [];
      group.push(alarm);
      alarmsByToken.set(alarm.deviceToken, group);
    }
    const groups = [...alarmsByToken.values()];
    await Promise.all(
      groups.map((group) =>
        this.sendTokenNotifications(group, stationArrivalInfoMap).catch(() => {
          this.logger.error(
            `Failed to process alarm group; alarmId=${group[0]._id}`,
          );
        }),
      ),
    );
  }

  private async sendTokenNotifications(
    alarms: RegularAlarm[],
    arrivals: Map<string, ResponseData>,
  ): Promise<void> {
    for (const alarm of alarms) {
      const busInfo = arrivals
        .get(alarm.arsId)
        .msgBody.itemList.find(
          (item) =>
            item.busRouteId === alarm.busRouteId &&
            (item.adirection === null || item.adirection === alarm.adirection),
        );
      const content = busInfo ? MessageUtil.getMessageContent(busInfo) : null;
      try {
        if (content) {
          await this.fcmService.sendWithSubTitle(
            alarm.deviceToken,
            content.subTitle,
            content.message,
          );
        } else {
          await this.fcmService.send(
            alarm.deviceToken,
            MESSAGE.NOTIFICATION.ERROR,
          );
        }
      } catch (error) {
        if (isInvalidFcmTokenError(error)) {
          await this.invalidateToken(alarm);
          return;
        }
        this.logger.error(`FCM send failed; alarmId=${alarm._id}`);
      }
    }
  }

  private async invalidateToken(alarm: RegularAlarm): Promise<void> {
    try {
      const updated = await this.regularAlarmRepository.markTokenInvalid(
        alarm.deviceToken,
      );
      this.logger.warn(
        `Invalid FCM token; alarmId=${alarm._id}; updated=${updated}`,
      );
    } catch {
      this.logger.error(
        `Failed to persist invalid token state; alarmId=${alarm._id}`,
      );
    }
  }

  private async getStationArrivalInfoMap(
    alarms: RegularAlarm[],
  ): Promise<Map<string, ResponseData>> {
    const stationArrivalInfoMap: Map<string, ResponseData> = new Map();
    for (const alarm of alarms) {
      const stationId = alarm.arsId;

      if (!stationArrivalInfoMap.has(stationId)) {
        const result = await this.busInfoService.arriveStation(alarm.arsId);
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
