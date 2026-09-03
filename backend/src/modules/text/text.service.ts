import {
	BadRequestException,
	ConflictException,
	HttpException,
	InternalServerErrorException,
	Injectable,
	NotFoundException,
	Logger,
} from "@nestjs/common";
import { CreateTextDto, CreateTextResponseDto } from "./dto/create-text.dto";
import { PrismaService } from "../prisma/prisma.service";
import { GetTextChunkDto, GetTextChunkResponseDto } from "./dto/get-text.dto";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { Source } from "prisma/generated/enums";
import { GutenbergTxtLoaderService } from "../gutenberg_loader/gutenberg-txt-loader.service";
import { TextLoadResult } from "./interfaces";

@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);

	constructor(
		private readonly prismaService: PrismaService,
		private readonly gutenbergLoader: GutenbergTxtLoaderService,
	) {}

	public async create({ bookId, title }: CreateTextDto): Promise<CreateTextResponseDto> {
		let book: TextLoadResult;

		try {
			book = await this.gutenbergLoader.loadText(bookId);
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			this.logger.error(`Failed to load the book #${bookId}: ${errorMessage}`);

			throw new BadRequestException(`Failed to process the book: ${errorMessage}`);
		}

		try {
			// Вложенная запись: Text и TextContent создаются одной транзакцией Prisma.
			const text = await this.prismaService.text.create({
				data: {
					title: book.title ?? title,
					language: book.language,
					source: Source.GUTENBERG,
					sourceObjId: bookId,
					sourceMeta: book.meta,
					content: { create: { content: book.content } },
				},
				select: { id: true, title: true },
			});

			return { id: text.id, title: text.title };
		} catch (error) {
			if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
				throw new ConflictException(`Book #${bookId} has already been imported`);
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while creating text: ${errorMessage}`, errorStack);

			throw new InternalServerErrorException(errorMessage);
		}
	}

	public async getOne({ id }: GetTextChunkDto) {
		const text = await this.prismaService.text.findUnique({
			where: {
				id,
			},
			select: {
				title: true,
				source: true,
				content: true,
			},
		});

		if (!text) {
			throw new NotFoundException(`Text by id: ${id} does not found`);
		}

		return text;
	}
}
