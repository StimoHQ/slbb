import { BadRequestException } from "@nestjs/common";

/**
 * Контент не проходит по языку проекта (LearningLanguage) либо язык не удаётся установить.
 * Бросается ещё на этапе потокового чтения, чтобы вызывающий ответил 400 и не писал в БД.
 */
export class UnsupportedLanguageException extends BadRequestException {
	constructor(details: string) {
		super(`Unsupported language: ${details}`);
	}
}
