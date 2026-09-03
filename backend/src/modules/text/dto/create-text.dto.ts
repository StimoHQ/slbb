import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsNumber, IsString } from "class-validator";

export class CreateTextDto {
	@ApiProperty({
		example: "Test",
	})
	@IsString()
	title!: string;

	@ApiProperty({
		description: "Book id from https://www.gutenberg.org/ebooks/{bookId}",
		example: 11,
	})
	@IsNumber()
	bookId!: number;
}

export class CreateTextResponseDto {
	id!: number;
	title!: string;
}
