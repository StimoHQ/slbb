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
import { TextChunkRow, TextLoadResult } from "./interfaces";
import { CHUNK_MAX_SCAN_MULTIPLIER, CHUNK_WINDOW_MULTIPLIER, findSentenceCut, findWordCut, isWindowEnd } from "./utils";

@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);

	constructor(
		private readonly prismaService: PrismaService,
		private readonly gutenbergLoader: GutenbergTxtLoaderService,
	) {}

	public async create({ bookId, title }: CreateTextDto): Promise<CreateTextResponseDto> {
		const alreadyImported = await this.prismaService.text.findUnique({
			where: { source_sourceObjId: { source: Source.GUTENBERG, sourceObjId: bookId } },
			select: { id: true },
		});

		if (alreadyImported) {
			throw new ConflictException(`Book #${bookId} has already been imported`);
		}

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
			// Страховка от гонки: два параллельных запроса прошли проверку до загрузки.
			if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
				throw new ConflictException(`Book #${bookId} has already been imported`);
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while creating text: ${errorMessage}`, errorStack);

			throw new InternalServerErrorException(errorMessage);
		}
	}

	public async getChunkTextContent({ id, offset, limit }: GetTextChunkDto): Promise<GetTextChunkResponseDto> {
		const scanLength = limit * CHUNK_MAX_SCAN_MULTIPLIER;
		const windowLength = Math.min(limit * CHUNK_WINDOW_MULTIPLIER, scanLength);
		let row = await this.readChunkWindow(id, offset, windowLength);

		if (offset > row.totalLength) {
			throw new BadRequestException(
				`Offset ${offset} is beyond the text #${id} length ${row.totalLength}. Use offset: ${row.totalLength} to finish reading`,
			);
		}

		let cut = findSentenceCut(row.window, limit, isWindowEnd(row.window, windowLength));

		if (!cut) {
			// Закрытой границы предложения в первом окне нет: дочитываем до потолка скана.
			row = await this.readChunkWindow(id, offset, scanLength);
			const isEof = isWindowEnd(row.window, scanLength);

			cut = findSentenceCut(row.window, limit, isEof);

			if (!cut) {
				cut = findWordCut(row.window, scanLength, isEof);
				this.logger.warn(
					`Text #${id} has no sentence end within ${scanLength} chars after offset ${offset}: cut at a word boundary`,
				);
			}
		}

		const endOffset = offset + cut.endPoints;
		const isEnd = endOffset >= row.totalLength;

		return {
			textId: id,
			title: row.title,
			language: row.language,
			content: row.window.slice(0, cut.endUnits),
			startOffset: offset,
			endOffset,
			nextOffset: isEnd ? null : endOffset,
			totalLength: row.totalLength,
			isEnd,
		};
	}

	/**
	 * Окно читается на стороне БД: чанк для читалки выбирают десятки раз на книгу,
	 * и тянуть ради этого весь `text_contents` было бы расточительно.
	 */
	private async readChunkWindow(id: number, offset: number, length: number): Promise<TextChunkRow> {
		let rows: TextChunkRow[];

		try {
			// length/substr считают code points — в них же наружу отдаются offset'ы ответа.
			rows = await this.prismaService.$queryRaw<TextChunkRow[]>`
				SELECT t."title"                  AS "title",
				       t."language"::text        AS "language",
				       length(tc."content")::int AS "totalLength",
				       substr(tc."content", ${offset + 1}::int, ${length}::int) AS "window"
				FROM "texts" t
				JOIN "text_contents" tc ON tc."text_id" = t."id"
				WHERE t."id" = ${id}::int
				LIMIT 1`;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while reading the chunk of text #${id}: ${errorMessage}`, errorStack);

			throw new InternalServerErrorException(errorMessage);
		}

		if (!rows.length) {
			throw new NotFoundException(`Text by id: ${id} does not found`);
		}

		return rows[0];
	}
}
