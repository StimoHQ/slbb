import { type UserWords, type Word } from 'prisma/generated/client';
import { WordCreateInput } from 'prisma/generated/models';
import { PrismaService } from 'src/modules/prisma/prisma.service';

export class WordRepository {
  constructor(private readonly prismaService: PrismaService) {}

  public async create(word: WordCreateInput) {
    return await this.prismaService.word.create({
      data: word,
    });
  }

  public async get(id: Word['id'] | undefined) {
    return await this.prismaService.word.findUnique({
      where: {
        id,
      },
    });
  }

  public async getWordsByUser(userId: UserWords['userId'] | undefined) {
    return await this.prismaService.userWords.findMany({
      where: {
        userId,
      },
    });
  }

  public async addWordToUser(
    wordId: UserWords['wordId'],
    userId: UserWords['userId'],
  ) {
    return await this.prismaService.userWords.create({
      data: {
        userId,
        wordId,
      },
    });
  }
}
