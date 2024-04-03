import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MESSAGE } from '../../../../common/message';

export class EnrollRequestDto {
  @IsString()
  deviceToken: string;

  @IsString()
  @MinLength(4, { message: MESSAGE.DTO.REGULAR_ALARM.TIME })
  @MaxLength(4, { message: MESSAGE.DTO.REGULAR_ALARM.TIME })
  time: string;

  @IsNumber({}, { each: true, message: MESSAGE.DTO.REGULAR_ALARM.DAY_TYPE })
  @ArrayMinSize(1, { message: MESSAGE.DTO.REGULAR_ALARM.DAY_LENGTH_MIN })
  @ArrayMaxSize(7, { message: MESSAGE.DTO.REGULAR_ALARM.DAY_LENGTH_MAX })
  day: number[];

  @IsNumber()
  busRouteId: number;

  @IsNumber()
  arsId: number;
}
