/**
 * Смоук-проверка живого Gutenberg API-клиента (RapidAPI): meta + cleaned text.
 * Тратит 2 запроса из месячной квоты. Запуск: pnpm gutenberg:smoke [bookId]
 */
import "dotenv/config";
import axios from "axios";

const bookId = Number(process.argv[2] ?? 11);
const host = process.env["X-RapidAPI-Host-Gutenberg"];
const key = process.env["X-RapidAPI-Key"];

if (!host || !key) {
	console.error("[smoke] X-RapidAPI-Host-Gutenberg / X-RapidAPI-Key are not set in .env");
	process.exitCode = 1;
} else {
	main().catch((error: unknown) => {
		console.error("[smoke] FAILED:", error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const headers = { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host, Accept: "application/json" };

	const meta = (await axios.get(`https://${host}/books/${bookId}`, { headers })).data.results[0];
	console.log(
		`[smoke] meta: "${meta.title}" languages=${JSON.stringify(meta.languages)} available=${meta.is_available}`,
	);

	const text = (
		await axios.get(`https://${host}/books/${bookId}/text`, {
			headers,
			params: { cleaning_mode: "simple" },
		})
	).data;
	const head = String(text.text).slice(0, 120).replace(/\n/g, " ");
	console.log(
		`[smoke] text: mode=${text.cleaning_mode} original=${text.metadata.original_length} cleaned=${text.metadata.cleaned_length}`,
	);
	console.log(`[smoke] first chars: ${head}`);
	console.log("[smoke] OK");
}
