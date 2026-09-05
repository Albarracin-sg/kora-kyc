import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { AppConfigService } from "../../config/app-config.service";

export const ASSET_GROUP = {
  TESSERACT: "tesseract",
  HUMAN: "human",
} as const;

export type AssetGroup = (typeof ASSET_GROUP)[keyof typeof ASSET_GROUP];

export interface KycAssetManifestEntry {
  id: string;
  group: AssetGroup;
  relativePath: string;
  source: string;
  version: string;
  sha256: string;
}

export interface KycAssetManifest {
  generatedAt: string;
  assets: KycAssetManifestEntry[];
}

export class LocalModelAssetError extends Error {
  constructor() {
    super("Required local KYC model assets are unavailable or failed integrity validation");
    this.name = "LocalModelAssetError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetGroup(value: unknown): value is AssetGroup {
  return value === ASSET_GROUP.TESSERACT || value === ASSET_GROUP.HUMAN;
}

function isAssetEntry(value: unknown): value is KycAssetManifestEntry {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isAssetGroup(value.group) &&
    typeof value.relativePath === "string" &&
    typeof value.source === "string" &&
    typeof value.version === "string" &&
    typeof value.sha256 === "string"
  );
}

function isAssetManifest(value: unknown): value is KycAssetManifest {
  return (
    isObject(value) &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.assets) &&
    value.assets.every(isAssetEntry)
  );
}

@Injectable()
export class AssetIntegrityService {
  private manifestPromise: Promise<KycAssetManifest> | null = null;
  private readonly assetRoot: string;

  constructor(private readonly configService: AppConfigService) {
    this.assetRoot = dirname(configService.values.assetManifestPath);
  }

  async ensureGroup(group: AssetGroup): Promise<void> {
    const manifest = await this.loadManifest();
    const groupAssets = manifest.assets.filter((asset) => asset.group === group);

    if (groupAssets.length === 0) {
      throw new LocalModelAssetError();
    }

    await Promise.all(groupAssets.map((asset) => this.validateAsset(asset)));
  }

  private async loadManifest(): Promise<KycAssetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.readManifest();
    }

    try {
      return await this.manifestPromise;
    } catch (error: unknown) {
      this.manifestPromise = null;
      throw error;
    }
  }

  private async readManifest(): Promise<KycAssetManifest> {
    try {
      const source = await readFile(this.configService.values.assetManifestPath, "utf8");
      const parsed: unknown = JSON.parse(source);
      if (!isAssetManifest(parsed)) {
        throw new LocalModelAssetError();
      }

      return parsed;
    } catch (error: unknown) {
      if (error instanceof LocalModelAssetError) {
        throw error;
      }

      throw new LocalModelAssetError();
    }
  }

  private async validateAsset(asset: KycAssetManifestEntry): Promise<void> {
    const assetPath = this.resolveRelativePath(asset.relativePath);

    try {
      await access(assetPath);
      const body = await readFile(assetPath);
      const calculatedChecksum = createHash("sha256").update(body).digest("hex");
      if (calculatedChecksum !== asset.sha256) {
        throw new LocalModelAssetError();
      }
    } catch (error: unknown) {
      if (error instanceof LocalModelAssetError) {
        throw error;
      }

      throw new LocalModelAssetError();
    }
  }

  private resolveRelativePath(relativePath: string): string {
    const targetPath = resolve(this.assetRoot, relativePath);
    if (!targetPath.startsWith(`${this.assetRoot}${sep}`)) {
      throw new LocalModelAssetError();
    }

    return targetPath;
  }
}
