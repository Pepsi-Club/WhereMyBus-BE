import { IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class EnrollRequestDto {
  @IsString()
  deviceToken: string;

  @IsString()
  time: string;

  @MaxLength(7, { each: true })
  @MinLength(1)
  day: number[];

  @IsNumber()
  busRouteId: number;

  @IsNumber()
  arsId: number;
}
