import {
  FACE_VERIFICATION_PROVIDER,
  type AppConfiguration,
} from "../../config/app-config.service";
import type { FaceVerificationProvider } from "./face-verification.provider";

export function selectFaceVerificationProvider(
  configuration: Pick<AppConfiguration, "faceVerificationProvider">,
  createFaceServiceProvider: () => FaceVerificationProvider,
  localProvider: FaceVerificationProvider,
): FaceVerificationProvider {
  switch (configuration.faceVerificationProvider) {
    case FACE_VERIFICATION_PROVIDER.FACE_SERVICE:
      return createFaceServiceProvider();
    case FACE_VERIFICATION_PROVIDER.LOCAL:
      return localProvider;
  }
}