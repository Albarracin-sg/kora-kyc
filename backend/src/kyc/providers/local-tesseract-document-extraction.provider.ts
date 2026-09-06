import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { access } from "node:fs/promises";
import { join } from "node:path";
import Tesseract = require("tesseract.js");
import { AppConfigService } from "../../config/app-config.service";
import { ASSET_GROUP, AssetIntegrityService } from "../assets/asset-integrity.service";
import {
  DOCUMENT_PARSE_OUTCOME,
  type DocumentExtractionProvider,
  type DocumentExtractionResult,
  type LabeledDocumentImage,
} from "./document-extraction.provider";
import { parseColombianCedula } from "./colombian-cedula-parser";

export { parseColombianCedula } from "./colombian-cedula-parser";

@Injectable()
export class LocalTesseractDocumentExtractionProvider
  implements DocumentExtractionProvider, OnModuleDestroy
{
  readonly audit = {
    provider: "local",
    model: "tesseract-spa",
  };
  private scheduler: Tesseract.Scheduler | null = null;
  private schedulerInitialization: Promise<Tesseract.Scheduler> | null = null;

  constructor(
    private readonly configService: AppConfigService,
    private readonly assetIntegrityService: AssetIntegrityService,
  ) {}

  async extract(images: LabeledDocumentImage[]): Promise<DocumentExtractionResult> {
    if (images.length === 0) {
      return {
        confidence: 0,
        parsedDocument: {
          outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
          documentType: null,
          documentNumber: null,
          fullName: null,
          birthDate: null,
          issueDate: null,
          sex: null,
          height: null,
          bloodType: null,
          birthPlace: null,
          reasonCode: "NO_DOCUMENT_PROVIDED",
        },
        frontPresent: false,
        backPresent: false,
        audit: this.audit,
      };
    }

    const scheduler = await this.getScheduler();
    let bestConfidence = 0;
    let bestParsedText = "";
    let combinedText = "";

    for (const image of images) {
      const recognition = await scheduler.addJob("recognize", image.buffer);
      const text = recognition.data.text;
      const confidence = recognition.data.confidence / 100;

      combinedText += `\n--- ${image.side} ---\n${text}`;

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestParsedText = text;
      }
    }

    const frontPresent = images.some((image) => image.side === "FRONT");
    const backPresent = images.some((image) => image.side === "BACK");
    const parsedDocument = parseColombianCedula(combinedText);

    return {
      confidence: bestConfidence,
      parsedDocument,
      frontPresent,
      backPresent,
      audit: this.audit,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }
  }

  private async getScheduler(): Promise<Tesseract.Scheduler> {
    if (!this.schedulerInitialization) {
      this.schedulerInitialization = this.createScheduler();
    }

    try {
      return await this.schedulerInitialization;
    } catch (error: unknown) {
      this.schedulerInitialization = null;
      throw error;
    }
  }

  private async createScheduler(): Promise<Tesseract.Scheduler> {
    await this.assetIntegrityService.ensureGroup(ASSET_GROUP.TESSERACT);

    const { tesseractLangPath, ocrWorkerCount } = this.configService.values;
    await access(join(tesseractLangPath, "spa.traineddata.gz"));

    const scheduler = Tesseract.createScheduler();
    const workers = await Promise.all(
      Array.from({ length: ocrWorkerCount }, async () => {
        const worker = await Tesseract.createWorker("spa", Tesseract.OEM.LSTM_ONLY, {
          langPath: tesseractLangPath,
          gzip: true,
          cacheMethod: "none",
          logger: () => undefined,
          errorHandler: () => undefined,
        });
        scheduler.addWorker(worker);
      }),
    );

    void workers;
    this.scheduler = scheduler;
    return scheduler;
  }
}
