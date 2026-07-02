import { Module } from '@nestjs/common';
import { BookLoaderService } from './book-loader.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],
  providers: [BookLoaderService],
  exports: [BookLoaderService],
})
export class BookLoaderModule {}
