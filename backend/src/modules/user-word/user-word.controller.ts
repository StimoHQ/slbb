import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UserWordService } from './user-word.service';
import { CreateUserWordDto } from './dto/create-user-word.dto';
import { UpdateUserWordDto } from './dto/update-user-word.dto';

@Controller('user-word')
export class UserWordController {
  constructor(private readonly userWordService: UserWordService) {}

  @Post()
  create(@Body() createUserWordDto: CreateUserWordDto) {
    return this.userWordService.create(createUserWordDto);
  }

  @Get()
  findAll() {
    return this.userWordService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userWordService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserWordDto: UpdateUserWordDto) {
    return this.userWordService.update(+id, updateUserWordDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userWordService.remove(+id);
  }
}
