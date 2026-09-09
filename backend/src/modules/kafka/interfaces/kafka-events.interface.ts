/**
 * Контракты событий очереди Kafka.
 * Конвейер источник-агностичен: событие говорит «загрузить текст задачи textId»,
 * а какой источник — решает консьюмер по Text.source, а не по имени события.
 * Ключ сообщения — textId: сохраняет порядок задач по одной строке Text
 * и позволяет консьюмеру идемпотентно обрабатывать повторные доставки.
 */

/** Producer(TextService) -> Consumer(Ingestion): скачать текст из источника и сохранить по предложениям. */
export interface TextDownloadEvent {
	/** id строки Text (status QUEUED), под которой поставлена задача */
	textId: number;
	/** id внешнего объекта у источника (Text.sourceObjId) — кладём рядом, чтобы не перечитывать Text ради скачивания */
	sourceObjId: number;
}

/** Kafka не валидирует payload — битое сообщение не должно ронять консьюмера. */
export function isTextDownloadEvent(value: unknown): value is TextDownloadEvent {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		Number.isInteger(candidate.textId) &&
		(candidate.textId as number) > 0 &&
		Number.isInteger(candidate.sourceObjId) &&
		(candidate.sourceObjId as number) > 0
	);
}
