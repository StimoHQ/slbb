import {
	BadRequestException,
	Injectable,
	NotFoundException,
	ConflictException,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { CreateTextDto } from "./dto/create-text.dto";
import { BookLoaderService } from "../book-loader/book-loader.service";
import { PrismaService } from "../prisma/prisma.service";
import { GetOneTextDto } from "./dto/get-text.dto";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";

@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);

	constructor(
		private readonly bookLoader: BookLoaderService,
		private readonly prismaService: PrismaService,
	) {}

	public async create({ bookId, format, type }: CreateTextDto) {
		if (type !== "BOOK" || format !== "HTML") {
			throw new BadRequestException(
				`Type: "${type}" with format: ${format} does not support yet. Only: BOOK in HTML`,
			);
		}
		// Parse the Book
		let book: { title: string; content: string };
		try {
			book = await this.bookLoader.getHtmlBookFromZip("local", "test-data/pg11-h.zip");
			// const htmlBook = await this.bookLoader.getHtmlBookFromZip(
			//   'url',
			//   `https://www.gutenberg.org/cache/epub/${createTextDto.bookId}/pg${createTextDto.bookId}-h.zip`,
			// );
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			throw new BadRequestException(`Failed to process book archive: ${errorMessage}`);
		}

		// Save to DataBase
		try {
			const text = await this.prismaService.text.create({
				data: {
					title: book.title,
					type,
					format,
					sourceObjId: bookId,
				},
			});

			await this.prismaService.textContent.create({
				data: {
					textId: text.id,
					content: book.content,
				},
			});

			return { id: text.id, title: text.title };
		} catch (error) {
			if (error instanceof PrismaClientKnownRequestError) {
				// Unique cosntraint
				if (error.code === "P2002") {
					throw new ConflictException("Text already exists");
				}
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while creating text: ${errorMessage}`, errorStack);

			throw new InternalServerErrorException(`${errorMessage}`);
		}
	}

	public async getOne({ id }: GetOneTextDto) {
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
