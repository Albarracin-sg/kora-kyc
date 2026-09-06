import {
  FILE_STORAGE_PROVIDER,
  type AppConfiguration,
} from "../../config/app-config.service";
import type { FileStorage } from "./file-storage.port";

export function selectFileStorageProvider(
  configuration: Pick<AppConfiguration, "fileStorageProvider">,
  createLocalStorage: () => FileStorage,
  createB2Storage: () => FileStorage,
): FileStorage {
  if (configuration.fileStorageProvider === FILE_STORAGE_PROVIDER.B2) {
    return createB2Storage();
  }

  return createLocalStorage();
}
