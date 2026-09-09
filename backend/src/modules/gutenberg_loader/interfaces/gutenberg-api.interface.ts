/** Ответы Project Gutenberg Books API (агрегатор на RapidAPI). */

export interface GutenbergAuthorMeta {
	id: number;
	name: string;
	webpage?: string | null;
}

export interface GutenbergBookMeta {
	id: number;
	title: string;
	alternative_title: string | null;
	authors: GutenbergAuthorMeta[];
	/** Может прийти пустым даже у англоязычной книги — язык тогда детектится по тексту. */
	languages?: string[];
	subjects?: string[];
	bookshelves?: string[];
	media_type?: string;
	download_count?: number;
	reading_ease_score?: string | null;
	cover_image?: string | null;
	summary?: string | null;
	/** Карта MIME → URL файла на gutenberg.org (txt без ключа и лимитов запросов). */
	formats?: Record<string, string>;
	removed_from_catalog?: string | null;
	is_available?: boolean;
}

/** GitHub-style конверт, в который завёрнуты и list-, и single-эндпоинты. */
export interface GutenbergEnvelope<T> {
	next: string | null;
	previous: string | null;
	results: T[];
}

export interface GutenbergCleanedText {
	book_id: number;
	title: string;
	alternative_title: string | null;
	cleaning_mode: "simple" | "super";
	text: string;
	metadata: {
		original_length: number;
		cleaned_length: number;
		source_format: string;
		source_url: string;
	};
}
