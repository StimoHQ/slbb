import { Module } from '@nestjs/common';
import { TextWordService } from './text-word.service';
import { TextWordController } from './text-word.controller';

@Module({
  controllers: [TextWordController],
  providers: [TextWordService],
})
export class TextWordModule {}
