import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { GetTextChunkDto, GetTextChunkQueryDto } from "../../dto/get-text.dto";

function invalidProperties(instance: object): string[] {
	return validateSync(instance)
		.map(({ property }) => property)
		.sort();
}

describe("GetTextChunkQueryDto", () => {
	it("takes the query pair without the id that arrives from the path", () => {
		const dto = plainToInstance(GetTextChunkQueryDto, { offset: "0", limit: "3000" });

		expect(invalidProperties(dto)).toEqual([]);
		expect(dto).toEqual({ offset: 0, limit: 3000 });
	});

	it("inherits the range validators of the base dto", () => {
		const dto = plainToInstance(GetTextChunkQueryDto, { offset: "-5", limit: "50" });

		expect(invalidProperties(dto)).toEqual(["limit", "offset"]);
	});

	it("keeps requiring the id in the dto the service works with", () => {
		expect(invalidProperties(plainToInstance(GetTextChunkDto, { offset: 0, limit: 3000 }))).toEqual(["id"]);
	});
});
