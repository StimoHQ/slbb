import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';
import * as unzipper from 'unzipper';
import * as fs from 'fs';
import * as path from 'path';
import * as htmlparser2 from 'htmlparser2';

@Injectable()
export class BookLoaderService {
  constructor(private readonly httpService: HttpService) {}

  private logger = new Logger(BookLoaderService.name);

  public async getHtmlBookFromZip(
    sourceType: 'url' | 'local',
    sourcePath: string,
  ): Promise<{ content: string; title: string }> {
    let zipStream: Readable;

    if (sourceType === 'local') {
      const absolutePath = path.resolve(process.cwd(), sourcePath);
      this.logger.log(`Reading the zip file from path: ${absolutePath}`);

      if (!fs.existsSync(absolutePath)) {
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
      const zipParser = zipStream.pipe(unzipper.Parse({ forceStream: true }));

      for await (const e of zipParser) {
        const entry = e as unzipper.Entry;

        if (entry.path.endsWith('.html') && entry.type === 'File') {
          this.logger.log(
            `Found HTML file: ${entry.path} size: ${(entry.extra.uncompressedSize / (1024 * 1024)).toFixed(2)} Mb}`,
          );

          let language = '';
          let title = '';
          let htmlString: string = '';

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

          // Lets check the file (entry) by chunks
          for await (const chunk of entry) {
            let chunkStr = chunk.toString('utf8');
            htmlString += chunkStr;

            htmlParser.write(chunkStr);
            if (language && language !== 'en') {
              htmlParser.end();
              throw new BadRequestException('This is not English book');
            }
          }

          console.log(`language: ${language} title: ${title}`);

          htmlParser.end();
          return { content: htmlString, title: title || entry.path };
        } else {
          // Just ignore other files and continue
          entry.autodrain();
        }
      }
      throw new BadRequestException('HTML File not found');
    } catch (error) {
      throw new BadRequestException(
        `Unable to extract data from ZIP file ${error.message}`,
      );
    } finally {
      !zipStream.destroyed && zipStream.destroy();
    }
  }
}
