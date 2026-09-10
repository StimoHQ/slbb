import {
	Injectable,
	NotFoundException,
	ConflictException,
	InternalServerErrorException,
	ServiceUnavailableException,
	Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CreateTextDto } from "./dto/create-text.dto";
import { TextTaskResponseDto } from "./dto/text-task.dto";
import { PrismaService } from "../prisma/prisma.service";
import { GetTextChunkDto } from "./dto/get-text.dto";
import { PrismaClientKnownRequestError } from "prisma/generated/internal/prismaNamespace";
import { IngestionStatus, Source } from "prisma/generated/enums";
import { type TextDownloadTask } from "prisma/generated/client";
import { KafkaService } from "../kafka/kafka.service";
import { type TextDownloadEvent } from "../kafka/interfaces/kafka-events.interface";

/** Поля задачи, из которых собирается ответ; text — снятый отдельно привязанный Text. */
type TaskFields = Pick<
	TextDownloadTask,
	"id" | "status" | "source" | "sourceObjId" | "ingestError" | "finishedAt" | "textId"
>;
type TextSummary = { id: number; title: string; sentenceCount: number };

/** Сброс задачи в «поставлена в очередь»: стирает историю предыдущей попытки. */
const QUEUED_RESET = { status: IngestionStatus.QUEUED, ingestError: null, finishedAt: null };

/**
 * Владелец строки Text и её задачи загрузки. Сам текст здесь не качается и не разбивается:
 * create только ставит задачу TextDownloadTask (QUEUED) в Kafka, исполнитель — IngestionService
 * в отдельном worker-процессе (src/entrypoints/worker). Text появляется только когда задача дошла до READY.
 */
@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);
	private readonly downloadTopic: string;

	constructor(
		private readonly prismaService: PrismaService,
		private readonly kafka: KafkaService,
		configService: ConfigService,
	) {
		this.downloadTopic = configService.getOrThrow<string>("KAFKA_TOPIC_TEXT_DOWNLOAD");
	}

	/**
	 * Ставит задачу на скачивание и разбивку и сразу отвечает: книга из источника
	 * может идти минуты, держать ради этого HTTP-запроса нет смысла.
	 *
	 * Повторный POST над FAILED или QUEUED перепоставляет ту же задачу (дубль сообщения
	 * безвреден: claim в исполнителе — CAS по статусу), над PROCESSING или READY — конфликт.
	 *
	 * @returns taskId — по нему клиент опрашивает GET /text/tasks/:taskId.
	 */
	public async create({ source, sourceObjId }: CreateTextDto): Promise<TextTaskResponseDto> {
		const { task, isNew } = await this.openTask(source, sourceObjId);

		try {
			await this.publish(task.id, sourceObjId);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Failed to queue the download task ${task.id}: ${errorMessage}`, errorStack);

			await this.rollbackQueueing(task.id, isNew, errorMessage);

			throw new ServiceUnavailableException("Text download task has not been queued, please retry");
		}

		this.logger.log(`Task ${task.id} queued for ingestion (source object: ${source} #${sourceObjId})`);

		return this.toTaskResponse(task);
	}

	/**
	 * Статус задачи: по нему клиент решает, можно ли уже читать текст. READY носит textId,
	 * FAILED — причину в ingestError. Только чтение БД, в Kafka этот путь не ходит.
	 */
	public async getTaskStatus(taskId: number): Promise<TextTaskResponseDto> {
		const task = await this.prismaService.textDownloadTask.findUnique({
			where: { id: taskId },
			select: {
				id: true,
				status: true,
				source: true,
				sourceObjId: true,
				ingestError: true,
				finishedAt: true,
				textId: true,
				text: { select: { id: true, title: true, _count: { select: { sentences: true } } } },
			},
		});

		if (!task) {
			throw new NotFoundException(`Text download task by id: ${taskId} not found`);
		}

		const { text, ...fields } = task;
		const summary: TextSummary | undefined = text
			? { id: text.id, title: text.title, sentenceCount: text._count.sentences }
			: undefined;

		return this.toTaskResponse(fields, summary);
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

		// Контент хранится по предложениям; пагинация по ним — отдельный этап, здесь склейка.
		const { sentences, ...meta } = text;
		return { ...meta, content: sentences.map((sentence) => sentence.content).join("") };
	}

	/**
	 * Задача в состоянии QUEUED: либо новая строка, либо перепоставка уже существующей —
	 * решается по её текущему статусу.
	 */
	private async openTask(source: Source, sourceObjId: number): Promise<{ task: TextDownloadTask; isNew: boolean }> {
		try {
			const task = await this.prismaService.textDownloadTask.create({
				data: { source, sourceObjId, ...QUEUED_RESET },
			});

			return { task, isNew: true };
		} catch (error) {
			// Unique constraint — штатный «такая задача уже есть», решаем по её текущему статусу.
			if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
				return this.requeueExisting(source, sourceObjId);
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while opening a download task: ${errorMessage}`, errorStack);

			throw new InternalServerErrorException(`${errorMessage}`);
		}
	}

	/**
	 * Повторный POST над существующей задачей: QUEUED (сообщение могло потеряться в очереди)
	 * и FAILED перепоставляем, PROCESSING и READY — отказ.
	 */
	private async requeueExisting(
		source: Source,
		sourceObjId: number,
	): Promise<{ task: TextDownloadTask; isNew: boolean }> {
		const existing = await this.prismaService.textDownloadTask.findUnique({
			where: { source_sourceObjId: { source, sourceObjId } },
		});

		if (!existing) {
			// Строку удалили между create и чтением (каскад от удаления текста); повтор POST разрулит.
			throw new ConflictException(`Text download task for ${source} #${sourceObjId} already exists`);
		}

		if (existing.status === IngestionStatus.PROCESSING) {
			throw new ConflictException(`Text download task ${existing.id} is already in progress`);
		}

		if (existing.status === IngestionStatus.READY) {
			throw new ConflictException(`Text is already ingested (textId=${existing.textId})`);
		}

		const task = await this.prismaService.textDownloadTask.update({
			where: { id: existing.id },
			data: QUEUED_RESET,
		});

		return { task, isNew: false };
	}

	private async publish(taskId: number, sourceObjId: number): Promise<void> {
		const event: TextDownloadEvent = { textTaskId: taskId, sourceObjId };
		// Ключ — id задачи: доставки по одной задаче не переставляются между партициями.
		await this.kafka.publish(this.downloadTopic, String(taskId), event);
	}

	/**
	 * Отказ Kafka. Новую строку удаляем, перепоставленную возвращаем в FAILED: иначе QUEUED
	 * без сообщения осталась бы занятой по @@unique([source, sourceObjId]) и отрезала бы
	 * клиенту повторный POST.
	 */
	private async rollbackQueueing(taskId: number, isNew: boolean, reason: string): Promise<void> {
		try {
			if (isNew) {
				await this.prismaService.textDownloadTask.delete({ where: { id: taskId } });

				return;
			}

			await this.prismaService.textDownloadTask.update({
				where: { id: taskId },
				data: {
					status: IngestionStatus.FAILED,
					ingestError: `Task has not been queued: ${reason}`,
					finishedAt: new Date(),
				},
			});
		} catch (error) {
			// Очистка не важнее ответа клиенту: причину отказа очереди зафиксировали выше.
			this.logger.warn(`Could not roll back the unqueued task ${taskId}: ${error}`);
		}
	}

	private toTaskResponse(task: TaskFields, text?: TextSummary): TextTaskResponseDto {
		return {
			taskId: task.id,
			status: task.status,
			source: task.source,
			sourceObjId: task.sourceObjId,
			textId: text?.id ?? task.textId,
			textTitle: text?.title ?? null,
			sentenceCount: text?.sentenceCount ?? 0,
			ingestError: task.ingestError,
			finishedAt: task.finishedAt,
		};
	}
}
