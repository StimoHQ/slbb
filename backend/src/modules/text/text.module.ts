import { Module } from '@nestjs/common';
import { TextService } from './text.service';
import { TextController } from './text.controller';
import { BookLoaderModule } from '../book-loader/book-loader.module';

@Module({
  imports: [BookLoaderModule],
  controllers: [TextController],
  providers: [TextService],
})
export class TextModule {}
