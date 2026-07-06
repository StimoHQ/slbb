import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TextService } from './text.service';
import { CreateTextDto } from './dto/create-text.dto';
import { ApiOperation } from '@nestjs/swagger';
import { GetOneTextDto } from './dto/get-text.dto';

@Controller('text')
export class TextController {
  constructor(private readonly textService: TextService) {}

  @ApiOperation({
    summary: 'Creates the text',
  })
  @Post()
  async create(@Body() createTextDto: CreateTextDto) {
    const newText = await this.textService.create(createTextDto);
    return { ...newText, message: 'Text has been created' };
  }

  @ApiOperation({
    summary: 'Get the text by ID',
  })
  @HttpCode(HttpStatus.OK)
  @Get(':id')
  async getOne(@Param() params: GetOneTextDto) {
    const text = await this.textService.getOne(params);
    return { ...text, message: 'Text has been received' };
  }
}
