import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CatalogEntry = {
	name: string;
	source: string;
	path: string;
	when?: string;
};

export type SkillCatalog = {
	version: number;
	updated?: string;
	policy?: string;
	default: CatalogEntry[];
	on_demand: CatalogEntry[];
	archived?: { root: string; names: string[] };
};

const here = dirname(fileURLToPath(import.meta.url));

export function catalogPath(): string {
	return join(here, "../../config/skill-catalog.json");
}

export function loadCatalog(): SkillCatalog {
	const raw = readFileSync(catalogPath(), "utf8");
	return JSON.parse(raw) as SkillCatalog;
}

export function expandPath(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p.startsWith("./")) return join(here, "../..", p.slice(2));
	return p;
}

export function findEntry(catalog: SkillCatalog, name: string): CatalogEntry | undefined {
	const needle = name.trim().toLowerCase();
	return (
		catalog.default.find((e) => e.name.toLowerCase() === needle) ??
		catalog.on_demand.find((e) => e.name.toLowerCase() === needle)
	);
}

export function formatCatalog(catalog: SkillCatalog): string {
	const def = catalog.default.map((e) => `  ${e.name}  [${e.source}]`).join("\n");
	const extra = catalog.on_demand
		.filter((e) => !catalog.default.some((d) => d.name === e.name))
		.map((e) => `  ${e.name}  [${e.source}]  ${e.when ?? ""}`.trimEnd())
		.join("\n");
	const archived = catalog.archived?.names?.length
		? `\narchived (${catalog.archived.root}): ${catalog.archived.names.join(", ")}`
		: "";
	return [
		catalog.policy ?? "Thin default roster. Pull on-demand skills when the directory needs them.",
		"",
		"default (already loaded when Acidbath is installed):",
		def,
		"",
		"on-demand ( /skills pull <name> ):",
		extra || "  (none)",
		archived,
	].join("\n");
}
