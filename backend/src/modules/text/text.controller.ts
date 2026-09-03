import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Query } from "@nestjs/common";
import { TextService } from "./text.service";
import { CreateTextDto } from "./dto";
import { ApiOperation } from "@nestjs/swagger";
import { GetTextChunkDto } from "./dto";


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
		summary: "Get the text by ID",
	})
	@HttpCode(HttpStatus.OK)
	@Get(":id")
	async getOne(@Param() params: GetTextChunkDto) {
		const text = await this.textService.getOne(params);
		return { ...text, message: "Text has been received" };
	}
}
