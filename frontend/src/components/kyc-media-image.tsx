import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import {
  getAuthenticatedMediaSource,
  type AuthenticatedMediaSource,
} from "../services/api-client";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

const MEDIA_SOURCE_RETRY_LIMIT = 1;

interface KycMediaImageProps {
  mediaId: string;
  accessibilityLabel: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
}

export function KycMediaImage({
  mediaId,
  accessibilityLabel,
  style,
  resizeMode = "cover",
}: KycMediaImageProps): ReactNode {
  const [source, setSource] = useState<AuthenticatedMediaSource | null>(null);
  const [failed, setFailed] = useState(false);
  const retryAttemptsRef = useRef(0);

  useEffect(() => {
    let isCurrent = true;
    retryAttemptsRef.current = 0;
    setSource(null);
    setFailed(false);

    getAuthenticatedMediaSource(mediaId)
      .then((resolvedSource) => {
        if (isCurrent) {
          setSource(resolvedSource);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setFailed(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [mediaId]);

  function handleImageError(): void {
    if (retryAttemptsRef.current >= MEDIA_SOURCE_RETRY_LIMIT) {
      setFailed(true);
      return;
    }

    // The access token baked into the Image source can become stale because
    // RN Image bypasses axios interceptors. Re-resolve the source once (this
    // refreshes the token when needed) and only then fall back to the
    // placeholder, so a rotated token yields at most one retry and never loops.
    retryAttemptsRef.current += 1;
    setSource(null);
    setFailed(false);

    getAuthenticatedMediaSource(mediaId).then(
      (resolvedSource) => {
        setSource(resolvedSource);
      },
      () => {
        setFailed(true);
      },
    );
  }

  if (failed) {
    return (
      <View style={[styles.placeholder, style]} accessibilityLabel={accessibilityLabel}>
        <Text style={styles.placeholderText}>Imagen no disponible</Text>
      </View>
    );
  }

  if (!source) {
    return (
      <View style={[styles.placeholder, style]} accessibilityLabel={accessibilityLabel}>
        <ActivityIndicator color={COLORS.mint} />
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={source}
      style={style}
      resizeMode={resizeMode}
      onError={handleImageError}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.panelRaised,
    borderRadius: RADIUS.sm,
  },
  placeholderText: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 12,
    textAlign: "center",
    padding: SPACING.xs,
  },
});