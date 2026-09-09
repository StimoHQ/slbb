/**
 * Смоук реального конвейера инжестии (без HTTP-сервера и без Kafka-доставки):
 * ручная сборка графа лоадера + IngestionService на скомпилированном dist/,
 * живые запросы: 2 к Gutenberg API (квота) + 1 к LibreTranslate + запись в БД.
 * Запуск: pnpm ingestion:smoke [bookId]  (нужен свежий pnpm build)
 */
require("reflect-metadata");

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../dist/prisma/generated/client");
const { HttpService } = require("@nestjs/axios");
const { GutenbergApiService } = require("../dist/src/modules/gutenberg_loader/gutenberg-api.service");
const { GutenbergTxtLoader } = require("../dist/src/modules/gutenberg_loader/gutenberg-txt.loader");
const { IngestionService } = require("../dist/src/modules/ingestion/ingestion.service");

const sourceObjId = Number(process.argv[2] ?? 11);

const configStub = {
	getOrThrow: (key) => {
		const value = process.env[key];
		if (value === undefined || value === "") {
			throw new Error(`Missing env ${key}`);
		}
		return value;
	},
};

async function main() {
	const prisma = new PrismaClient({
		adapter: new PrismaPg({ connectionString: configStub.getOrThrow("DATABASE_URL") }),
	});

	try {
		const existing = await prisma.text.findUnique({
			where: { source_sourceObjId: { source: "GUTENBERG", sourceObjId } },
		});

		const task = existing
			? await prisma.text.update({
					where: { id: existing.id },
					data: { status: "QUEUED", ingestError: null },
				})
			: await prisma.text.create({
					data: { title: `smoke-${sourceObjId}`, sourceObjId, status: "QUEUED" },
				});

		console.log(`[smoke] task textId=${task.id} status=${task.status}`);

		const http = new HttpService();
		const api = new GutenbergApiService(http, configStub);
		const loader = new GutenbergTxtLoader(api, http, configStub);
		const ingestion = new IngestionService(prisma, loader);

		const started = Date.now();
		await ingestion.process(task.id);
		console.log(`[smoke] process finished in ${Date.now() - started}ms`);

		const done = await prisma.text.findUniqueOrThrow({
			where: { id: task.id },
			select: { title: true, status: true, language: true, ingestedAt: true },
		});
		const count = await prisma.textSentence.count({ where: { textId: task.id } });
		const head = await prisma.textSentence.findMany({
			where: { textId: task.id },
			orderBy: { position: "asc" },
			take: 3,
			select: { position: true, content: true },
		});

		console.log(`[smoke] ${JSON.stringify(done)} sentences=${count}`);
		for (const s of head) {
			console.log(`  [${s.position}] ${s.content.slice(0, 80)}`);
		}
		console.log("[smoke] OK — строка Text и text_sentences обновлены в БД");
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[smoke] FAILED:", error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
