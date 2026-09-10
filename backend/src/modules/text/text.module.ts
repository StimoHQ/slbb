import { Module } from "@nestjs/common";
import { TextService } from "./text.service";
import { TextController } from "./text.controller";
import { KafkaModule } from "../kafka/kafka.module";

@Module({
	// Скачивание текста здесь не выполняется: TextService только ставит задачу в очередь,
	// исполнитель — IngestionService в worker-процессе (src/entrypoints/worker).
	imports: [KafkaModule],
	controllers: [TextController],
	providers: [TextService],
})
export class TextModule {}
