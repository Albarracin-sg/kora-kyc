import { Injectable } from "@nestjs/common";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppConfigService } from "../../config/app-config.service";
import type { FileStorage, StorageWriteInput } from "./file-storage.port";

const SAFE_STORAGE_KEY = /^[a-zA-Z0-9/_-]+\.jpg$/;

@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly rootDirectory: string;

  constructor(configService: AppConfigService) {
    this.rootDirectory = resolve(configService.values.localStorageRoot);
  }

  async write(input: StorageWriteInput): Promise<void> {
    const destination = this.resolveKey(input.key);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporaryPath = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, input.body, { mode: 0o600 });
    await rename(temporaryPath, destination);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    if (!SAFE_STORAGE_KEY.test(key)) {
      throw new Error("Invalid local storage key");
    }

    const resolvedPath = resolve(this.rootDirectory, key);
    const rootPrefix = `${this.rootDirectory}${sep}`;
    if (!resolvedPath.startsWith(rootPrefix)) {
      throw new Error("Local storage key escapes the configured root");
    }

    return resolvedPath;
  }
}
