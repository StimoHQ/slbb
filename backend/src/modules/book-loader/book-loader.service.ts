import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { Readable } from "stream";
import * as unzipper from "unzipper";
import * as fs from "fs";
import * as path from "path";
import * as htmlparser2 from "htmlparser2";
import { access } from "fs/promises";
import { StringDecoder } from "string_decoder";

@Injectable()
export class BookLoaderService {
	constructor(private readonly httpService: HttpService) {}

	private readonly logger = new Logger(BookLoaderService.name);

	public async getHtmlBookFromZip(
		sourceType: "url" | "local",
		sourcePath: string,
	): Promise<{ content: string; title: string }> {
		let zipStream = await this.createStream(sourceType, sourcePath);
		return await this.parseZipStream(zipStream);
	}

	private async createStream(sourceType: "url" | "local", sourcePath: string) {
		if (sourceType === "local") {
			const absolutePath = path.resolve(process.cwd(), sourcePath);
			this.logger.log(`Reading the zip file from path: ${absolutePath}`);

			try {
				await access(absolutePath);
			} catch {
				throw new Error(`File doesn't exists at: ${absolutePath}`);
			}

			return fs.createReadStream(absolutePath);
		} else {
			this.logger.log(`Start reading the zip file from URL: ${sourcePath}`);
			try {
				const response = await firstValueFrom(
					this.httpService.get<Readable>(sourcePath, {
						responseType: "stream",
					}),
				);
				return response.data;
			} catch {
				throw new Error(`Something went wrong with Reading the zip file from URL: ${sourcePath}`);
			}
		}
	}

	private async parseZipStream(zipStream: Readable) {
		try {
			const MAX_AVAILABLE_SIZE: number = 5 * 1024 * 1024; // 5 MB
			const zipParser = zipStream.pipe(unzipper.Parse({ forceStream: true }));

			for await (const e of zipParser) {
				const entry = e as unzipper.Entry;

				if (entry.path.endsWith(".html") && entry.type === "File") {
					this.logger.log(
						`Found HTML file: ${entry.path} size: ${(entry.extra.uncompressedSize / (1024 * 1024)).toFixed(2)} Mb}`,
					);

					let language = "";
					let title = "";

					// Create the Html parser instance
					const htmlParser = new htmlparser2.Parser({
						onopentag(name, attribs) {
							if (name === "meta" && attribs["name"] === "dc.title" && !title) {
								title = attribs["content"];
							}
							if (name === "meta" && attribs["name"] === "dc.language" && !language) {
								language = attribs["content"];
							}
						},
					});

					const stringDecoder = new StringDecoder("utf-8");

					try {
						let totalSize = 0;
						const chunks: string[] = [];
						// Lets check the file (entry) by chunks
						// Every chunk is Buffer type
						for await (const chunk of entry) {
							totalSize += chunk.length;
							if (totalSize > MAX_AVAILABLE_SIZE) {
								throw new Error(
									`HTML file exceeds maximum size of ${MAX_AVAILABLE_SIZE / (1024 * 1024)} MB`,
								);
							}

							const chunkStr = stringDecoder.write(chunk);
							chunks.push(chunkStr);
							htmlParser.write(chunkStr);

							if (language && language !== "en") {
								throw new Error("This is not an English book");
							}
						}

						// Check if there's something left
						const finalStr = stringDecoder.end();
						if (finalStr) {
							chunks.push(finalStr);
							htmlParser.write(finalStr);
						}

						if (!language) {
							throw new Error("Unrecognizable language");
						}

						return { content: chunks.join(""), title: title || entry.path };
					} finally {
						//cleane up
						htmlParser.end();
						if (!entry.destroyed) entry.destroy();
					}
				} else {
					// Just ignore other files and continue
					entry.autodrain();
				}
			}
			throw new Error("HTML File not found");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`Database error while creating text: ${errorMessage}`, errorStack);

			throw new Error(errorMessage);
		} finally {
			if (!zipStream.destroyed) zipStream.destroy();
		}
	}
}
