import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, ParseIntPipe } from "@nestjs/common";
import { TextService } from "./text.service";
import { CreateTextDto } from "./dto/create-text.dto";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { GetTextChunkDto } from "./dto/get-text.dto";
import { TextTaskResponseDto } from "./dto/text-task.dto";

@Controller("text")
export class TextController {
	constructor(private readonly textService: TextService) {}

	@ApiOperation({
		summary: "Queues the text download and sentence splitting",
		description:
			"Отвечает сразу, не дожидаясь скачивания: текст качает из источника и разбивает consumer из очереди Kafka. " +
			"Повторный POST над FAILED или QUEUED перепоставляет ту же задачу; над PROCESSING или READY — 409.",
	})
	@ApiResponse({ status: HttpStatus.ACCEPTED, type: TextTaskResponseDto })
	@Post()
	@HttpCode(HttpStatus.ACCEPTED)
	async create(@Body() createTextDto: CreateTextDto) {
		const task = await this.textService.create(createTextDto);
		return { message: "Text download task has been queued", ...task };
	}

	@ApiOperation({
		summary: "Get the download task status",
		description: "Poll until status=READY, then read the content with GET /text/{textId} from this response.",
	})
	@ApiResponse({ status: HttpStatus.OK, type: TextTaskResponseDto })
	@HttpCode(HttpStatus.OK)
	@Get("tasks/:taskId")
	async getTaskStatus(@Param("taskId", ParseIntPipe) taskId: number) {
		const task = await this.textService.getTaskStatus(taskId);
		return { ...task, message: "Text download task status has been received" };
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
