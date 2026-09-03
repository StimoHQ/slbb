import {
	Injectable,
	NotFoundException,
	Logger,
} from "@nestjs/common";
import { CreateTextDto, CreateTextResponseDto } from "./dto/create-text.dto";
import { PrismaService } from "../prisma/prisma.service";
import { GetTextChunkDto, GetTextChunkResponseDto } from "./dto/get-text.dto";

@Injectable()
export class TextService {
	private readonly logger = new Logger(TextService.name);

	constructor(private readonly prismaService: PrismaService) {}

	public async create({ bookId }: CreateTextDto): Promise<CreateTextResponseDto> {}

	public async getOne({ id }: GetTextChunkDto) {
		const text = await this.prismaService.text.findUnique({
			where: {
				id,
			},
			select: {
				title: true,
				source: true,
				content: true,
			},
		});

		if (!text) {
			throw new NotFoundException(`Text by id: ${id} does not found`);
		}

		return text;
	}
}
