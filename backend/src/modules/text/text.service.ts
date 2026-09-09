import {
	BadRequestException,
	Injectable,
	NotFoundException,
	ConflictException,
	InternalServerErrorException,
	HttpException,
	Logger,
} from "@nestjs/common";
import { CreateTextDto, CreateTextResponseDto } from "./dto/create-text.dto";
import { PrismaService } from "../prisma/prisma.service";
import { GetTextChunkDto, GetTextChunkResponseDto } from "./dto/get-text.dto";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { GutenbergTxtLoader } from "../gutenberg_loader/gutenberg-txt.loader";
import { type TextLoadResult } from "./interfaces";

@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);

	constructor(
		private readonly gutenbergLoader: GutenbergTxtLoader,
		private readonly prismaService: PrismaService,
	) {}

	// ВРЕМЕННО до конвейера Kafka (этапы 5-6): единственный источник — Gutenberg,
	// поэтому его лоадер вызывается напрямую и синхронно. Маршрутизация по source
	// появится, когда в enum Source реально добавится второй элемент.
	public async create({ source, sourceObjId }: CreateTextDto): Promise<CreateTextResponseDto> {
		let loaded: TextLoadResult;
		try {
			loaded = await this.gutenbergLoader.load(sourceObjId);
		} catch (error) {
			// Доменные коды лоадера (NotFound/Quota/…) не превращаем в 400.
			if (error instanceof HttpException) {
				throw error;
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			throw new BadRequestException(`Failed to load text from source: ${errorMessage}`);
		}
		// Save to DataBase
		try {
			const text = await this.prismaService.text.create({
				data: {
					title: loaded.title,
					source,
					sourceObjId,
					language: loaded.language,
					status: "READY",
					ingestedAt: new Date(),
				},
			});

			// ВРЕМЕННО до конвейера Kafka (этапы 3-5): конвейера разбивки ещё нет,
			// поэтому весь загруженный контент кладётся одной строкой с position 0.
			await this.prismaService.textSentence.create({
				data: {
					textId: text.id,
					position: 0,
					content: loaded.content,
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

	public async getOne({ id }: GetTextChunkDto) {
		const text = await this.prismaService.text.findUnique({
			where: {
				id,
			},
			select: {
				title: true,
				source: true,
				sentences: {
					orderBy: { position: "asc" },
					select: { content: true },
				},
			},
		});

		if (!text) {
			throw new NotFoundException(`Text by id: ${id} does not found`);
		}

		// Контент теперь хранится по предложениям; пагинация по ним — этап 6, здесь склейка.
		const { sentences, ...meta } = text;
		return { ...meta, content: sentences.map((sentence) => sentence.content).join("") };
	}
}
