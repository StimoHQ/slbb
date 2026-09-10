import { Injectable, Logger } from "@nestjs/common";
import { type TextDownloadTask } from "prisma/generated/client";
import { PrismaService } from "../prisma/prisma.service";
import { GutenbergTxtLoader } from "../gutenberg_loader/gutenberg-txt.loader";
import { type TextLoadResult } from "../text/interfaces";
import { splitIntoSentences } from "./utils/split-into-sentences";

/** Размер пачки createMany: держим транзакцию и память предсказуемыми на толстых книгах. */
const SENTENCES_BATCH_SIZE = 500;

/**
 * Источник-агностичный исполнитель задачи TextDownloadTask: берёт строку задачи из очереди
 * Kafka, грузит контент лоадером нужного source, разбивает на предложения и одной транзакцией
 * создаёт Text вместе с text_sentences. Строка Text появляется только в момент READY —
 * до этого у текста нет ни статуса, ни ошибок, всё они на задаче.
 * Статус-машина делает повторную доставку идемпотентной.
 */
@Injectable()
export class IngestionService {
	private readonly logger = new Logger(IngestionService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly gutenbergLoader: GutenbergTxtLoader,
	) {}

	/** @returns false, если задача уже выполнена/теряется (не тот статус или удалена). */
	public async process(textTaskId: number): Promise<boolean> {
		const task = await this.claim(textTaskId);

		if (!task) {
			this.logger.debug(`Skip task ${textTaskId}: not claimable (done or gone)`);

			return false;
		}

		try {
			const loaded = await this.loadBySource(task);
			const sentences = splitIntoSentences(loaded.content);

			if (sentences.length === 0) {
				throw new Error("No sentences recognized in the source text");
			}

			const textId = await this.persist(task, loaded, sentences);
			this.logger.log(`Task ${textTaskId} ingested: text ${textId}, ${sentences.length} sentences`);

			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";

			await this.markFailed(textTaskId, errorMessage);
			this.logger.error(`Task ${textTaskId} ingestion failed: ${errorMessage}`);

			throw error;
		}
	}

	/**
	 * CAS по статусу: в работу берутся только QUEUED и зависшие PROCESSING (консьюмер
	 * умер между claim и persist). READY/FAILED не перерабатываем без явного запроса:
	 * повторную постановку FAILED делает POST (см. TextService.create).
	 */
	private async claim(textTaskId: number): Promise<TextDownloadTask | null> {
		const updated = await this.prisma.textDownloadTask.updateMany({
			where: {
				id: textTaskId,
				status: { in: ["QUEUED", "PROCESSING"] },
			},
			data: { status: "PROCESSING", ingestError: null },
		});

		if (updated.count === 0) {
			return null;
		}

		return this.prisma.textDownloadTask.findUnique({ where: { id: textTaskId } });
	}

	private async loadBySource(task: TextDownloadTask): Promise<TextLoadResult> {
		switch (task.source) {
			case "GUTENBERG":
				return this.gutenbergLoader.load(task.sourceObjId);
		}
	}

	/**
	 * Единая транзакция: либо текст со всеми предложениями и READY-задача, либо ничего.
	 * Пересборка с нуля (deleteMany старых предложений) больше не нужна — при сбое
	 * транзакция откатывается целиком, и повторный старт не может застать половину вставки.
	 */
	private async persist(task: TextDownloadTask, loaded: TextLoadResult, sentences: string[]): Promise<number> {
		return this.prisma.$transaction(async (tx) => {
			const text = await tx.text.create({
				data: {
					title: loaded.title,
					language: loaded.language,
					source: task.source,
					sourceObjId: task.sourceObjId,
				},
			});

			const rows = sentences.map((content, position) => ({ textId: text.id, position, content }));

			for (let offset = 0; offset < rows.length; offset += SENTENCES_BATCH_SIZE) {
				await tx.textSentence.createMany({
					data: rows.slice(offset, offset + SENTENCES_BATCH_SIZE),
				});
			}

			await tx.textDownloadTask.update({
				where: { id: task.id },
				data: {
					status: "READY",
					textId: text.id,
					finishedAt: new Date(),
					ingestError: null,
				},
			});

			return text.id;
		});
	}

	private async markFailed(textTaskId: number, reason: string): Promise<void> {
		try {
			await this.prisma.textDownloadTask.update({
				where: { id: textTaskId },
				data: { status: "FAILED", ingestError: reason, finishedAt: new Date() },
			});
		} catch (error) {
			// строка могла быть удалена параллельно — это не перекрывает исходную ошибку
			this.logger.warn(`Could not mark task ${textTaskId} as FAILED: ${error}`);
		}
	}
}
