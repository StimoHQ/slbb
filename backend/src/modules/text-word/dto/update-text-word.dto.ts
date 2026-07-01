import { PartialType } from '@nestjs/mapped-types';
import { CreateTextWordDto } from './create-text-word.dto';

export class UpdateTextWordDto extends PartialType(CreateTextWordDto) {}
