import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";
import { LearningLanguage } from "prisma/generated/enums";

/** Параметры чанка из query-строки. */
export class GetTextChunkQueryDto {
	@ApiProperty({
		description: "Starts a fetch data from the beginning of the Text by given offset",
		example: 0,
		minimum: 0,
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	offset!: number;

	@ApiProperty({
		description: "Limit of fething data from the Text(starts from given offset)",
		example: 3000,
		minimum: 100,
		maximum: 20000,
	})
	@Type(() => Number)
	@IsInt()
	@Min(100)
	@Max(20000)
	limit!: number;
}

/** Контракт метода: query-параметры чанка плюс `id`, который приходит из пути. */
export class GetTextChunkDto extends GetTextChunkQueryDto {
	@ApiProperty({
		description: "ID from DB",
		example: 1,
	})
	@IsInt()
	id!: number;
}

export class GetTextChunkResponseDto {
	textId!: number;
	title!: string;
	language!: LearningLanguage;
	content!: string;
	startOffset!: number;
	endOffset!: number;
	nextOffset!: number | null;
	totalLength!: number;
	isEnd!: boolean;
}
