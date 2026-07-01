import { Injectable } from '@nestjs/common';
import { CreateTextWordDto } from './dto/create-text-word.dto';
import { UpdateTextWordDto } from './dto/update-text-word.dto';

@Injectable()
export class TextWordService {
  create(createTextWordDto: CreateTextWordDto) {
    return 'This action adds a new textWord';
  }

  findAll() {
    return `This action returns all textWord`;
  }

  findOne(id: number) {
    return `This action returns a #${id} textWord`;
  }

  update(id: number, updateTextWordDto: UpdateTextWordDto) {
    return `This action updates a #${id} textWord`;
  }

  remove(id: number) {
    return `This action removes a #${id} textWord`;
  }
}
