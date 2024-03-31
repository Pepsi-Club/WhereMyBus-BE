import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EnrollRequestDto {
  @IsString()
  deviceToken: string;

  @IsString()
  @MinLength(4, { message: '시간을 4자리로 입력해주세요.' })
  @MaxLength(4, { message: '시간을 4자리로 입력해주세요.' })
  time: string;

  @IsNumber({}, { each: true, message: '요일을 숫자로 나타내주세요' })
  @ArrayMinSize(1, { message: '알람받을 요일이 하루 이상이어야합니다.' })
  @ArrayMaxSize(7, { message: '알람받을 요일이 7개 초과일 수 없습니다.' })
  day: number[];

  @IsNumber()
  busRouteId: number;

  @IsNumber()
  arsId: number;
}
