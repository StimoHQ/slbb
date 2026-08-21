import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';
import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import * as htmlparser2 from 'htmlparser2';
import { access } from 'fs/promises';

@Injectable()
export class BookLoaderService {
  constructor(private readonly httpService: HttpService) {}

  private readonly logger = new Logger(BookLoaderService.name);

  public async getHtmlBookFromZip(
    sourceType: 'url' | 'local',
    sourcePath: string,
  ): Promise<{ content: string; title: string }> {
    let zipStream: Readable;

    if (sourceType === 'local') {
      const absolutePath = path.resolve(process.cwd(), sourcePath);
      this.logger.log(`Reading the zip file from path: ${absolutePath}`);

      try {
        await access(absolutePath);
      } catch {
        throw new BadRequestException(
          `File doesn't exists at: ${absolutePath}`,
        );
      }

      zipStream = fs.createReadStream(absolutePath);
    } else {
      this.logger.log(`Start reading the zip file from URL: ${sourcePath}`);
      try {
        const response = await firstValueFrom(
          this.httpService.get<Readable>(sourcePath, {
            responseType: 'stream',
          }),
        );

        zipStream = response.data;
      } catch {
        throw new BadRequestException(
          `Something went wrong with Reading the zip file from URL: ${sourcePath}`,
        );
      }
    }

    return this.parseZipStream(zipStream);
  }

  private async parseZipStream(zipStream: Readable) {
    try {
      const MAX_AVAILABLE_SIZE: number = 5 * 1024 * 1024; //5 MB
      const zipParser = zipStream.pipe(unzipper.Parse({ forceStream: true }));

      for await (const e of zipParser) {
        const entry = e as unzipper.Entry;

        if (entry.path.endsWith('.html') && entry.type === 'File') {
          this.logger.log(
            `Found HTML file: ${entry.path} size: ${(entry.extra.uncompressedSize / (1024 * 1024)).toFixed(2)} Mb}`,
          );

          let language = '';
          let title = '';

          // Create the Html parser instance
          const htmlParser = new htmlparser2.Parser({
            onopentag(name, attribs) {
              if (name === 'meta' && attribs['name'] === 'dc.title' && !title) {
                title = attribs['content'];
              }
              if (
                name === 'meta' &&
                attribs['name'] === 'dc.language' &&
                !language
              ) {
                language = attribs['content'];
              }
            },
          });

          let totalSize = 0;
          const chunks: string[] = [];

          // Lets check the file (entry) by chunks
          for await (const chunk of entry) {
            const chunkStr = chunk.toString('utf8');
            totalSize += chunk.length;
            if (totalSize > MAX_AVAILABLE_SIZE) {
              htmlParser.end();
              entry.autodrain();
              throw new BadRequestException(
                `HTML file exceeds maximum size of ${MAX_AVAILABLE_SIZE / (1024 * 1024)} MB`,
              );
            }
            chunks.push(chunkStr);
            htmlParser.write(chunkStr);

            if (language && language !== 'en') {
              htmlParser.end();
              entry.autodrain();
              throw new BadRequestException('This is not an English book');
            }
          }

          if (!language) {
            throw new BadRequestException('Unrecognizable language');
          }

          htmlParser.end();

          return { content: chunks.join(''), title: title || entry.path };
        } else {
          // Just ignore other files and continue
          entry.autodrain();
        }
      }

      throw new NotFoundException('HTML File not found');
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new BadRequestException(
        `Unable to extract data from ZIP file:\n ${error.message}`,
      );
    } finally {
      !zipStream.destroyed && zipStream.destroy();
    }
  }
}
