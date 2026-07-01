import { Module } from '@nestjs/common';
import { UserWordService } from './user-word.service';
import { UserWordController } from './user-word.controller';

@Module({
  controllers: [UserWordController],
  providers: [UserWordService],
})
export class UserWordModule {}
