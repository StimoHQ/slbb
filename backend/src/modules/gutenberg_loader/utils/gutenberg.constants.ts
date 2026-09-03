/** Базовый адрес plain-text копий Gutenberg; переопределяется `GUTENBERG_BASE_URL`. */
export const GUTENBERG_BASE_URL = "https://www.gutenberg.org/cache/epub";

/** Каталог с книгами для `GUTENBERG_SOURCE_TYPE=local`, относительный cwd процесса; переопределяется `GUTENBERG_LOCAL_DIR`. */
export const GUTENBERG_LOCAL_DIR = "test-data";

export const GUTENBERG_SOURCE_TYPES = { url: "url", local: "local" } as const;

/** Сколько байт прочитать до вердикта о языке: служебная шапка Gutenberg целиком в них умещается. */
export const LANGUAGE_PROBE_BYTES = 4 * 1024;

/** Образец текста для внешнего детектора языка (LibreTranslate переваривает немного). */
export const DETECTION_SAMPLE_LIMIT = 1_000;

/** Потолок размера книги: стрим с неизвестным Content-Length должен когда-то остановиться. */
export const MAX_BOOK_BYTES = 10 * 1024 * 1024;

export const HTTP_TIMEOUT_MS = 30_000;

/** Gutenberg раздаёт plain-text строго по этому имени файла — локальные фикстуры обязаны ему следовать. */
export function gutenbergTxtFileName(bookId: number): string {
	return `pg${bookId}.txt`;
}

/** Например https://www.gutenberg.org/cache/epub/79501/pg79501.txt — из параметров только номер книги. */
export function buildTxtUrl(baseUrl: string, bookId: number): string {
	return `${baseUrl.replace(/\/+$/, "")}/${bookId}/${gutenbergTxtFileName(bookId)}`;
}
