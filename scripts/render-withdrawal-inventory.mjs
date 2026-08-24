/**
 * Génère la vue lisible docs/migration/withdrawal-inventory.md depuis le
 * manifeste canonique docs/migration/withdrawal-inventory.yaml.
 *
 * La vue est entièrement dérivée : toute évolution du manifeste doit être
 * suivie de `pnpm migration:render`, et le gate (check-migration-manifests)
 * refuse une vue non régénérée.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalSha256,
  loadYamlDocument,
} from "./migration-manifest-lib.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "..");
export const manifestPath = join(
  repoRoot,
  "docs/migration/withdrawal-inventory.yaml",
);
export const viewPath = join(
  repoRoot,
  "docs/migration/withdrawal-inventory.md",
);

const NOMS_CONSERVATION = {
  atelier: "Atelier local autonome",
  "ui-neutre": "UI neutre",
  "mecanisme-test": "Mécanismes de test",
  "golden-neutre": "Goldens neutres",
  "actif-punks": "Actifs Punks",
  outillage: "Outillage neutre",
  "attente-refonte-ui": "Attente refonte UI",
};

function listeChemins(entries) {
  return entries.map((e) => `\`${e.chemin}\``).join(" ; ");
}

function details(entry) {
  const parts = [];
  if (entry.separation) {
    parts.push(`séparation : ${entry.separation}`);
  }
  if (entry.note) {
    parts.push(String(entry.note).replace(/\s+/g, " ").trim());
  }
  return parts.length > 0 ? ` — ${parts.join(" — ")}` : "";
}

/** Rendu déterministe de la vue complète (chaîne Markdown). */
export function renderMarkdown(manifest) {
  const lignes = [];
  lignes.push("# Inventaire de retrait Buzz → Punks — vue lisible");
  lignes.push("");
  lignes.push(
    "> Vue dérivée de [`withdrawal-inventory.yaml`](./withdrawal-inventory.yaml), qui est canonique.",
  );
  lignes.push(
    "> Régénérée par `scripts/render-withdrawal-inventory.mjs` (`pnpm migration:render`) — ne pas éditer.",
  );
  lignes.push(
    `> Décisions : issues [#13](https://github.com/mabzadev/punksbot/issues/13), [#14](https://github.com/mabzadev/punksbot/issues/14) et [#17](https://github.com/mabzadev/punksbot/issues/17).`,
  );
  lignes.push(
    `> Checkpoint de récupération : \`${manifest["checkpoint-recuperation"]}\` — baseline Buzz gelée : \`${manifest["baseline-buzz"]}\` — version ${manifest.version} — sha256 canonique \`${canonicalSha256(manifest)}\`.`,
  );
  lignes.push("");
  lignes.push(
    "Chaque actif reçoit exactement un verdict. Un module partagé appartient à la tranche de",
  );
  lignes.push(
    "son **dernier** consommateur ; ses parties antérieures disparaissent plus tôt (champ",
  );
  lignes.push(
    "« séparation »). Aucun renommage, dispatcher universel ou module mixte ne peut masquer",
  );
  lignes.push("une dépendance active.");
  lignes.push("");
  lignes.push("## Attribution par tranche");
  lignes.push("");
  lignes.push("| Tranche | Actifs retirés par le candidat accepté |");
  lignes.push("|---|---|");
  for (let n = 1; n <= 31; n += 1) {
    const entries = manifest.actifs.filter((a) => a.verdict === `tranche:${n}`);
    if (entries.length === 0) {
      continue;
    }
    lignes.push(`| ${n} | ${listeChemins(entries)} |`);
  }
  lignes.push("");
  lignes.push("## Scellement desktop (gate terminal, après la tranche 31)");
  lignes.push("");
  for (const entry of manifest.actifs.filter(
    (a) => a.verdict === "scellement",
  )) {
    lignes.push(`- \`${entry.chemin}\`${details(entry)}`);
  }
  lignes.push("");
  lignes.push("## Retrait global du serveur historique (entrée terminale)");
  lignes.push("");
  lignes.push(
    String(manifest["critere-retrait-global"]).replace(/\s+/g, " ").trim(),
  );
  lignes.push("");
  for (const entry of manifest.actifs.filter(
    (a) => a.verdict === "retrait-global",
  )) {
    lignes.push(`- \`${entry.chemin}\`${details(entry)}`);
  }
  lignes.push("");
  lignes.push("## Conservés (verdicts typés)");
  for (const [type, nom] of Object.entries(NOMS_CONSERVATION)) {
    const entries = manifest.actifs.filter(
      (a) => a.verdict === "conserve" && a.conservation === type,
    );
    if (entries.length === 0) {
      continue;
    }
    lignes.push("");
    lignes.push(`### ${nom}`);
    lignes.push("");
    for (const entry of entries) {
      lignes.push(`- \`${entry.chemin}\`${details(entry)}`);
    }
  }
  lignes.push("");
  lignes.push("## Allowlist Nostr (explicitement hors retrait)");
  lignes.push("");
  for (const item of manifest["allowlist-nostr"] ?? []) {
    lignes.push(`- **${item.envelope}** : ${item.portee}`);
  }
  lignes.push("");
  lignes.push("## Goldens");
  lignes.push("");
  if (manifest.goldens) {
    lignes.push(
      `- Foyer : \`${manifest.goldens.foyer}\` — Registre : \`${manifest.goldens.registre}\` — Univers indépendant : \`${manifest.goldens.univers}\` — Tests Buzz figés : \`${manifest.goldens["univers-tests"]}\``,
    );
    lignes.push(
      `- Politique : ${String(manifest.goldens.politique).replace(/\s+/g, " ").trim()}`,
    );
  }
  lignes.push("");
  return lignes.join("\n");
}

export function main() {
  const manifest = loadYamlDocument(manifestPath);
  const sortie = renderMarkdown(manifest);
  if (process.argv.includes("--check")) {
    const actuelle = readFileSync(viewPath, "utf8");
    if (actuelle !== sortie) {
      console.error(
        "docs/migration/withdrawal-inventory.md n'est pas la vue régénérée — lancez pnpm migration:render",
      );
      process.exit(1);
    }
    console.log("vue à jour");
    return;
  }
  mkdirSync(dirname(viewPath), { recursive: true });
  writeFileSync(viewPath, sortie);
  console.log(`vue régénérée : ${viewPath}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
