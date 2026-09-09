import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsInt } from "class-validator";
import { Source } from "prisma/generated/enums";

export class CreateTextDto {
	@ApiProperty({
		enum: Source,
		description: "Источник текста (загрузку выполняет consumer соответствующего источника)",
		example: Source.GUTENBERG,
	})
	@IsEnum(Source)
	source!: Source;

	@ApiProperty({
		description: "Идентификатор текста у источника. Для Gutenberg: https://www.gutenberg.org/ebooks/{sourceObjId}",
		example: 11,
	})
	@IsInt()
	sourceObjId!: number;
}

export class CreateTextResponseDto {
	id!: number;
	title!: string;
}
