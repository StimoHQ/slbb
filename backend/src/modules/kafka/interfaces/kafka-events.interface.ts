/**
 * Контракты событий очереди Kafka.
 * Конвейер источник-агностичен: событие говорит «выполни задачу загрузки textTaskId»,
 * а какой источник — решает исполнитель по TextDownloadTask.source, а не по имени события.
 * Ключ сообщения — id задачи: сохраняет порядок задач по одной строке и позволяет
 * консьюмеру идемпотентно обрабатывать повторные доставки.
 */

/** Producer(TextService) -> Consumer(Ingestion): скачать текст из источника и разбить на предложения. */
export interface TextDownloadEvent {
	/** id строки TextDownloadTask, под которой поставлена задача */
	textTaskId: number;
	/** id внешнего объекта у источника (TextDownloadTask.sourceObjId) — кладём рядом, чтобы не перечитывать задачу ради скачивания */
	sourceObjId: number;
}

/** Kafka не валидирует payload — битое сообщение не должно ронять консьюмера. */
export function isTextDownloadEvent(value: unknown): value is TextDownloadEvent {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		Number.isInteger(candidate.textTaskId) &&
		(candidate.textTaskId as number) > 0 &&
		Number.isInteger(candidate.sourceObjId) &&
		(candidate.sourceObjId as number) > 0
	);
}
