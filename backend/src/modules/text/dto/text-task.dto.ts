import { ApiProperty } from "@nestjs/swagger";
import { IngestionStatus, Source } from "prisma/generated/enums";

/**
 * Представление задачи загрузки — то, что клиент получает и на POST, и на поллинге.
 * До READY текстовая часть (textId/textTitle/sentenceCount) пустая: строки Text ещё нет.
 */
export class TextTaskResponseDto {
	@ApiProperty({ description: "id задачи (text_download_tasks.id), не путать с id текста", example: 1 })
	taskId!: number;

	@ApiProperty({
		enum: IngestionStatus,
		description: "QUEUED → PROCESSING → READY | FAILED",
		example: IngestionStatus.QUEUED,
	})
	status!: IngestionStatus;

	@ApiProperty({ enum: Source, example: Source.GUTENBERG })
	source!: Source;

	@ApiProperty({ description: "id объекта у источника", example: 11 })
	sourceObjId!: number;

	@ApiProperty({
		nullable: true,
		description: "Заполняется при READY: id созданного текста для GET /text/{textId}",
		example: null,
	})
	textId!: number | null;

	@ApiProperty({ nullable: true, description: "Заголовок из источника, появляется при READY" })
	textTitle!: string | null;

	@ApiProperty({ description: "Количество сохранённых предложений (0 до READY)", example: 0 })
	sentenceCount!: number;

	@ApiProperty({ nullable: true, description: "Причина отказа; заполнена при status=FAILED" })
	ingestError!: string | null;

	@ApiProperty({ type: Date, nullable: true, description: "Момент перехода в READY или FAILED" })
	finishedAt!: Date | null;
}
