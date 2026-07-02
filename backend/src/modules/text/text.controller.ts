import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TextService } from './text.service';
import { CreateTextDto } from './dto/create-text.dto';
import { UpdateTextDto } from './dto/update-text.dto';
import { ApiOperation } from '@nestjs/swagger';

@Controller('text')
export class TextController {
  constructor(private readonly textService: TextService) {}

  @ApiOperation({
    summary: 'Creates the text',
  })
  @HttpCode(HttpStatus.OK)
  @Post()
  create(@Body() createTextDto: CreateTextDto) {
    return this.textService.create(createTextDto);
  }
}
