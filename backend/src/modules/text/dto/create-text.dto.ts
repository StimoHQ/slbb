import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString } from 'class-validator';
import { TextFormat, TextType } from 'prisma/generated/enums';

export class CreateTextDto {
  @ApiProperty({
    example: 'Test',
  })
  @IsString()
  title: string;

  @ApiProperty({ enum: TextType })
  @IsEnum(TextType)
  type: TextType;

  @ApiProperty({ enum: TextFormat })
  @IsEnum(TextFormat)
  format: TextFormat;

  @ApiProperty({
    description: 'Book id from https://www.gutenberg.org/ebooks/{bookId}',
    example: 11,
  })
  @IsNumber()
  bookId: number;
}
