import { Injectable, Logger } from "@nestjs/common";
import { type Text } from "prisma/generated/client";
import { PrismaService } from "../prisma/prisma.service";
import { GutenbergTxtLoader } from "../gutenberg_loader/gutenberg-txt.loader";
import { type TextLoadResult } from "../text/interfaces";
import { splitIntoSentences } from "./utils/split-into-sentences";

/** Размер пачки createMany: держим транзакцию и память предсказуемыми на толстых книгах. */
const SENTENCES_BATCH_SIZE = 500;

/**
 * Источник-агностичный исполнитель задачи загрузки: забирает строку Text из очереди
 * Kafka, грузит контент лоадером нужного source, разбивает на предложения и атомарно
 * пересобирает text_sentences. Статус-машина делает повторную доставку идемпотентной.
 */
@Injectable()
export class IngestionService {

	private readonly logger = new Logger(IngestionService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly gutenbergLoader: GutenbergTxtLoader,
	) {}

	/** @returns false, если задача уже выполнена/теряется (не тот статус или удалена). */
	public async process(textId: number): Promise<boolean> {
		const text = await this.claim(textId);

		if (!text) {
			this.logger.debug(`Skip text ${textId}: not claimable (done or gone)`);

			return false;
		}

		try {
			const loaded = await this.loadBySource(text);
			const sentences = splitIntoSentences(loaded.content);

			if (sentences.length === 0) {
				throw new Error("No sentences recognized in the source text");
			}

			await this.persist(textId, loaded, sentences);
			this.logger.log(`Text ${textId} ingested: ${sentences.length} sentences`);

			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";

			await this.markFailed(textId, errorMessage);
			this.logger.error(`Text ${textId} ingestion failed: ${errorMessage}`);

			throw error;
		}
	}

	/**
	 * CAS по статусу: в работу берутся только QUEUED и зависшие PROCESSING (консьюмер
	 * умер между claim и persist). READY/FAILED не перерабатываем без явного запроса.
	 */
	private async claim(textId: number): Promise<Text | null> {
		const updated = await this.prisma.text.updateMany({
			where: {
				id: textId,
				status: { in: ["QUEUED", "PROCESSING"] },
			},
			data: { status: "PROCESSING", ingestError: null },
		});

		if (updated.count === 0) {
			return null;
		}

		return this.prisma.text.findUnique({ where: { id: textId } });
	}

	private async loadBySource(text: Text): Promise<TextLoadResult> {
		switch (text.source) {
			case "GUTENBERG":
				return this.gutenbergLoader.load(text.sourceObjId);
		}
	}

	private async persist(textId: number, loaded: TextLoadResult, sentences: string[]): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			// Пересборка с нуля: переживает повторный запуск после сбоя на середине вставки.
			await tx.textSentence.deleteMany({ where: { textId } });

			const rows = sentences.map((content, position) => ({ textId, position, content }));

			for (let offset = 0; offset < rows.length; offset += SENTENCES_BATCH_SIZE) {
				await tx.textSentence.createMany({
					data: rows.slice(offset, offset + SENTENCES_BATCH_SIZE),
				});
			}

			await tx.text.update({
				where: { id: textId },
				data: {
					title: loaded.title,
					language: loaded.language,
					status: "READY",
					ingestedAt: new Date(),
				},
			});
		});
	}

	private async markFailed(textId: number, reason: string): Promise<void> {
		try {
			await this.prisma.text.update({
				where: { id: textId },
				data: { status: "FAILED", ingestError: reason },
			});
		} catch (error) {
			// строка могла быть удалена параллельно — это не перекрывает исходную ошибку
			this.logger.warn(`Could not mark text ${textId} as FAILED: ${error}`);
		}
	}
}
