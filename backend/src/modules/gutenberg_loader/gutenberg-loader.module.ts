import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { LibreTranslateModule } from "../libretranslate/libretranslate.module";
import { GutenbergTxtLoaderService } from "./gutenberg-txt-loader.service";
import { HTTP_TIMEOUT_MS } from "./utils/gutenberg.constants";

@Module({
	imports: [HttpModule.register({ timeout: HTTP_TIMEOUT_MS, maxRedirects: 5 }), LibreTranslateModule],
	providers: [GutenbergTxtLoaderService],
	exports: [GutenbergTxtLoaderService],
})
export class GutenbergLoaderModule {}
