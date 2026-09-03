import { DETECTION_SAMPLE_LIMIT } from "./gutenberg.constants";

const BODY_START_MARKER = /^\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/im;

const HEADER_FIELDS = {
	languageRaw: /^language:\s*(.+)$/im,
	title: /^title:\s*(.+)$/im,
} as const;

export type GutenbergHeader = {
	languageRaw: string | null;
	title: string | null;
};

function fieldValue(head: string, pattern: RegExp): string | null {
	const value = pattern.exec(head)?.[1]?.trim();

	return value ? value : null;
}

/** Дальше этого маркера идёт текст книги, так что за метаданными ходить незачем — язык можно решать. */
export function isBookBodyStarted(sample: string): boolean {
	return BODY_START_MARKER.test(sample);
}

/** Метаданные служебной шапки Gutenberg; за маркером начала текста не собираем, чтобы не поймать строку из романа. */
export function parseGutenbergHeader(sample: string): GutenbergHeader {
	const marker = BODY_START_MARKER.exec(sample);
	const head = marker ? sample.slice(0, marker.index) : sample;

	return {
		languageRaw: fieldValue(head, HEADER_FIELDS.languageRaw),
		title: fieldValue(head, HEADER_FIELDS.title),
	};
}

/** Текст для внешнего детектора: без разметки и управляющих символов, не длиннее DETECTION_SAMPLE_LIMIT. */
export function extractDetectionSample(sample: string): string {
	const marker = BODY_START_MARKER.exec(sample);
	// Служебный пролог Gutenberg всегда англоязычный, поэтому без маркера начала книги берём хвост пробы — там уже текст романа.
	const body = marker ? sample.slice(marker.index + marker[0].length) : sample.slice(-DETECTION_SAMPLE_LIMIT * 4);

	return body
		.replace(/[^\p{L}\p{N} ']+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, DETECTION_SAMPLE_LIMIT);
}
