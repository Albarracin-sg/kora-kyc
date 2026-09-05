import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ASSET_GROUP = {
  TESSERACT: "tesseract",
  HUMAN: "human",
} as const;

type AssetGroup = (typeof ASSET_GROUP)[keyof typeof ASSET_GROUP];

const ASSET_SOURCE = {
  TESSERACT_SPANISH_URL:
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/spa.traineddata",
  TESSERACT_SPANISH_VERSION: "tessdata_fast-87416418657359cb625c412a48b6e1d6d41c29bd",
  HUMAN_PACKAGE: "@vladmandic/human",
} as const;

const HUMAN_MODEL_FILE = /^(blazeface|faceres)\.(json|bin)$/;

interface AssetManifestEntry {
  id: string;
  group: AssetGroup;
  relativePath: string;
  source: string;
  version: string;
  sha256: string;
}

interface AssetManifest {
  generatedAt: string;
  assets: AssetManifestEntry[];
}

interface HumanPackageMetadata {
  version: string;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function calculateChecksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

async function readHumanPackageMetadata(packageRoot: string): Promise<HumanPackageMetadata> {
  const rawMetadata = await readFile(join(packageRoot, "package.json"), "utf8");
  const parsedMetadata: unknown = JSON.parse(rawMetadata);
  if (
    typeof parsedMetadata !== "object" ||
    parsedMetadata === null ||
    !("version" in parsedMetadata) ||
    typeof parsedMetadata.version !== "string"
  ) {
    throw new Error("Could not read the installed Human package version");
  }

  return { version: parsedMetadata.version };
}

async function downloadSpanishLanguageModel(destination: string): Promise<void> {
  const response = await fetch(ASSET_SOURCE.TESSERACT_SPANISH_URL);
  if (!response.ok) {
    throw new Error(`Failed to download the local Spanish OCR model: HTTP ${response.status}`);
  }

  const sourceBody = Buffer.from(await response.arrayBuffer());
  if (sourceBody.length === 0) {
    throw new Error("Downloaded Spanish OCR model is empty");
  }

  await writeFile(destination, gzipSync(sourceBody), { mode: 0o600 });
}

async function createManifestEntry(
  assetRoot: string,
  id: string,
  group: AssetGroup,
  destination: string,
  source: string,
  version: string,
): Promise<AssetManifestEntry> {
  const body = await readFile(destination);
  return {
    id,
    group,
    relativePath: normalizePath(relative(assetRoot, destination)),
    source,
    version,
    sha256: calculateChecksum(body),
  };
}

async function bootstrapAssets(): Promise<void> {
  const assetRoot = resolve(process.cwd(), "assets");
  const tesseractDirectory = join(assetRoot, "tesseract");
  const humanModelsDirectory = join(assetRoot, "human-models");
  await Promise.all([
    mkdir(tesseractDirectory, { recursive: true, mode: 0o700 }),
    mkdir(humanModelsDirectory, { recursive: true, mode: 0o700 }),
  ]);

  const spanishModelDestination = join(tesseractDirectory, "spa.traineddata.gz");
  const forceDownload = process.argv.includes("--force");
  if (forceDownload) {
    await downloadSpanishLanguageModel(spanishModelDestination);
  } else {
    try {
      await stat(spanishModelDestination);
    } catch {
      await downloadSpanishLanguageModel(spanishModelDestination);
    }
  }

  const scriptRequire = createRequire(__filename);
  const humanEntryPoint = scriptRequire.resolve(ASSET_SOURCE.HUMAN_PACKAGE);
  const humanPackageRoot = resolve(dirname(humanEntryPoint), "..");
  const humanModelsSource = join(humanPackageRoot, "models");
  const humanPackage = await readHumanPackageMetadata(humanPackageRoot);
  const modelFiles = (await readdir(humanModelsSource)).filter((fileName) => HUMAN_MODEL_FILE.test(fileName));
  if (modelFiles.length !== 4) {
    throw new Error("The installed Human package does not provide the required BlazeFace and FaceRes assets");
  }

  await Promise.all(
    modelFiles.map((fileName) =>
      copyFile(join(humanModelsSource, fileName), join(humanModelsDirectory, fileName)),
    ),
  );

  const manifestEntries: AssetManifestEntry[] = [
    await createManifestEntry(
      assetRoot,
      "tesseract-spa",
      ASSET_GROUP.TESSERACT,
      spanishModelDestination,
      ASSET_SOURCE.TESSERACT_SPANISH_URL,
      ASSET_SOURCE.TESSERACT_SPANISH_VERSION,
    ),
    ...(await Promise.all(
      modelFiles.map((fileName) =>
        createManifestEntry(
          assetRoot,
          `human-${fileName}`,
          ASSET_GROUP.HUMAN,
          join(humanModelsDirectory, fileName),
          `npm:${ASSET_SOURCE.HUMAN_PACKAGE}`,
          humanPackage.version,
        ),
      ),
    )),
  ];
  const manifest: AssetManifest = {
    generatedAt: new Date().toISOString(),
    assets: manifestEntries,
  };

  await writeFile(join(assetRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
}

void bootstrapAssets().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown asset bootstrap failure";
  process.stderr.write(`KYC asset bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});
