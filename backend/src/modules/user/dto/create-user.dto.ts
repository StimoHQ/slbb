import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { User } from 'prisma/generated/client';

export class CreateUserDto {
  @ApiProperty({
    example: 'admin@gmail.com',
  })
  @IsNotEmpty()
  @IsEmail()
  public email: User['email'];
}
