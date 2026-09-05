export interface StorageWriteInput {
  key: string;
  body: Buffer;
}

export interface FileStorage {
  write(input: StorageWriteInput): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
