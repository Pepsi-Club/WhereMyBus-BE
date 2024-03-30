import { IsString } from 'class-validator';

export class DeleteRequestDto {
  @IsString()
  id: string;

  @IsString()
  deviceToken: string;
}
