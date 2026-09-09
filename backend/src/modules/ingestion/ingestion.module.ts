import { Module } from "@nestjs/common";
import { GutenbergLoaderModule } from "../gutenberg_loader/gutenberg-loader.module";
import { KafkaModule } from "../kafka/kafka.module";
import { IngestionService } from "./ingestion.service";
import { TextDownloadConsumer } from "./text-download.consumer";

@Module({
	imports: [KafkaModule, GutenbergLoaderModule],
	providers: [IngestionService, TextDownloadConsumer],
	exports: [IngestionService],
})
export class IngestionModule {}
