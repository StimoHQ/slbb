import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TextWordService } from './text-word.service';
import { CreateTextWordDto } from './dto/create-text-word.dto';
import { UpdateTextWordDto } from './dto/update-text-word.dto';

@Controller('text-word')
export class TextWordController {
  constructor(private readonly textWordService: TextWordService) {}

  @Post()
  create(@Body() createTextWordDto: CreateTextWordDto) {
    return this.textWordService.create(createTextWordDto);
  }

  @Get()
  findAll() {
    return this.textWordService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.textWordService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTextWordDto: UpdateTextWordDto) {
    return this.textWordService.update(+id, updateTextWordDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.textWordService.remove(+id);
  }
}
