import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { LibreTranslateService } from "./libretranslate.service";
import { DETECT_TIMEOUT_MS } from "./utils/libretranslate.constants";

@Module({
	imports: [HttpModule.register({ timeout: DETECT_TIMEOUT_MS, maxRedirects: 3 })],
	providers: [LibreTranslateService],
	exports: [LibreTranslateService],
})
export class LibreTranslateModule {}
