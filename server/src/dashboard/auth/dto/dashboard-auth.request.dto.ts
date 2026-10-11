import { IsString, MinLength } from 'class-validator';

export class DashboardAuthRequestDto {
  @IsString()
  @MinLength(1)
  code: string;
}
