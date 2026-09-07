/**
 * CLI entry point for the brief workflow:
 *   npm run brief -- --project pharos --language fr-CA
 */
import {
  runBriefWorkflow,
  isBriefLanguage,
  BRIEF_LANGUAGES,
} from "../src/lib/brief";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const projectKey = arg("project", "pharos")!;

  // Validate at runtime: a cast is erased, and this value reaches a filename.
  const languageArg = arg("language", "fr-CA")!;
  if (!isBriefLanguage(languageArg)) {
    console.error(
      `Invalid --language "${languageArg}". Expected one of: ${BRIEF_LANGUAGES.join(", ")}`
    );
    process.exit(1);
  }
  const language = languageArg;

  const project = await prisma.project.findUnique({ where: { key: projectKey } });
  if (!project) {
    console.error(`Unknown project: ${projectKey}`);
    process.exit(1);
  }

  console.log(`Running brief workflow for ${projectKey} (${language})…`);
  const result = await runBriefWorkflow({ projectKey, language });
  console.log(`Done. Brief: ${result.filePath}`);
  console.log(`Run:   ${result.runId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
