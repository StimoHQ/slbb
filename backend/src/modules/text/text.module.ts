import { Module } from "@nestjs/common";
import { TextService } from "./text.service";
import { TextController } from "./text.controller";
import { GutenbergLoaderModule } from "../gutenberg_loader/gutenberg-loader.module";

@Module({
	imports: [GutenbergLoaderModule],
	controllers: [TextController],
	providers: [TextService],
})
export class TextModule {}
