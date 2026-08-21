import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateTextDto } from './dto/create-text.dto';
import { BookLoaderService } from '../book-loader/book-loader.service';
import { PrismaService } from '../prisma/prisma.service';
import { GetOneTextDto } from './dto/get-text.dto';

@Injectable()
export class TextService {
  constructor(
    private readonly bookLoader: BookLoaderService,
    private readonly prismaService: PrismaService,
  ) {}

  public async create(createTextDto: CreateTextDto) {
    if (createTextDto.type !== 'BOOK' || createTextDto.format !== 'HTML') {
      throw new BadRequestException(
        `Type "${createTextDto.type}" does not support yet. Only: BOOK in HTML`,
      );
    }
    const { content, title } = await this.bookLoader.getHtmlBookFromZip(
      'local',
      'test-data/pg11-h.zip',
    );

    // const htmlBook = await this.bookLoader.getHtmlBookFromZip(
    //   'url',
    //   `https://www.gutenberg.org/cache/epub/${createTextDto.bookId}/pg${createTextDto.bookId}-h.zip`,
    // );

    try {
      const { bookId, type, format } = createTextDto;
      const text = await this.prismaService.text.create({
        data: {
          // content: htmlBook.content,
          title,
          type,
          format,
          sourceObjId: bookId,
        },
      });
      return { id: text.id, title: text.title };
    } catch (error) {
      // Unique cosntraint
      if (error.code === 'P2002') {
        throw new ConflictException('Text already exists');
      }
      throw new InternalServerErrorException(
        `Something went wrong by creating the text: ${error.message || 'Server Error!'}`,
      );
    }
  }

  public async getOne(params: GetOneTextDto) {
    const text = await this.prismaService.text.findUnique({
      where: {
        id: params.id,
      },
      select: {
        title: true,
        source: true,
        content: true,
      },
    });

    if (!text) {
      throw new NotFoundException(`Text by id: ${params.id} does not found`);
    }

    return text;
  }
}
