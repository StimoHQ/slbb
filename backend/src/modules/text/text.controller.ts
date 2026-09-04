import { Controller, Get, Post, Body, HttpCode, HttpStatus, ParseIntPipe, Param, Query } from "@nestjs/common";
import { TextService } from "./text.service";
import { CreateTextDto } from "./dto";
import { ApiOperation } from "@nestjs/swagger";
import { GetTextChunkQueryDto } from "./dto";

@Controller("text")
export class TextController {
	constructor(private readonly textService: TextService) {}

	@ApiOperation({
		summary: "Creates the text",
	})
	@Post()
	@HttpCode(HttpStatus.CREATED)
	async create(@Body() createTextDto: CreateTextDto) {
		const newText = await this.textService.create(createTextDto);
		return { message: "Text has been created", ...newText };
	}

	@ApiOperation({
		summary: "Get a chunk of the text",
		description: "The chunk starts at ?offset and ends on the nearest sentence boundary at or after offset+limit",
	})
	@HttpCode(HttpStatus.OK)
	@Get(":id")
	async getChunkTextContent(@Param("id", ParseIntPipe) id: number, @Query() query: GetTextChunkQueryDto) {
		const chunk = await this.textService.getChunkTextContent({ ...query, id });
		return { ...chunk, message: "Text chunk has been received" };
	}
}
