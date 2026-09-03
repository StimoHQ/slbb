import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { LearningLanguage } from "prisma/generated/enums";

export class GetTextChunkDto {
	@ApiProperty({
		description: "ID from DB",
		example: 1,
	})
	@IsInt()
	@Type(() => Number)
	id!: number;

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
