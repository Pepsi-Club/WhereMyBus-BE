import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RegularAlarm } from './regular-alarm.schema';
import { RegularAlarmService } from './regular-alarm.service';
import { EnrollRequestDto } from './dto/request/enroll.request.dto';
import { EnrollResponseDto } from './dto/response/enroll.response.dto';

@Controller('regular')
export class RegularAlarmController {
  constructor(private readonly regularAlarmService: RegularAlarmService) {}
  @Post()
  async enrollAlarm(
    @Body() enrollRegularDto: EnrollRequestDto,
  ): Promise<EnrollResponseDto> {
    const result = await this.regularAlarmService.enrollAlarm(enrollRegularDto);
    return new EnrollResponseDto(result._id);
  }

  @Delete()
  async deleteAlarm(
    @Param('deviceToken') deviceToken: string,
    @Param('alarmId') alarmId: string,
  ) {
    await this.regularAlarmService.deleteAlarm(deviceToken, alarmId);
    return { message: 'delete success' };
  }

  @Get('get')
  async getAll() {
    return this.regularAlarmService.getAll();
  }
}
