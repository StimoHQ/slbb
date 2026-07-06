import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber } from 'class-validator';

export class GetOneTextDto {
  @ApiProperty({
    description: 'ID from DB',
    example: 1,
  })
  @IsInt()
  @Transform(({ value }) => Number(value))
  id: number;
}
