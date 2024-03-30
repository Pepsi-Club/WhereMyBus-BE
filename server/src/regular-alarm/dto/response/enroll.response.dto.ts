import { Expose } from 'class-transformer';

export class EnrollResponseDto {
  @Expose()
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}
