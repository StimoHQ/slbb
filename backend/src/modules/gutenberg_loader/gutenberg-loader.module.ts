import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GutenbergApiService } from "./gutenberg-api.service";
import { GutenbergTxtLoader } from "./gutenberg-txt.loader";

@Module({
	imports: [
		HttpModule.register({
			timeout: 30000,
			maxRedirects: 5,
		}),
	],
	providers: [GutenbergApiService, GutenbergTxtLoader],
	exports: [GutenbergTxtLoader],
})
export class GutenbergLoaderModule {}
