import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GutenbergLoaderService } from "./gutenberg-loader.service";

@Module({
	imports: [
		HttpModule.register({
			timeout: 30000,
			maxRedirects: 5,
		}),
	],
	providers: [GutenbergLoaderService],
	exports: [GutenbergLoaderService],
})
export class GutenbergLoaderModule {}
