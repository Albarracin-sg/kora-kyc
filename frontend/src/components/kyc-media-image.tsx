import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsFocused } from "@react-navigation/native";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
  const isFocused = useIsFocused();
  const [source, setSource] = useState<AuthenticatedMediaSource | null>(null);
  const [failed, setFailed] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const retryAttemptsRef = useRef(0);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  useEffect(() => {
    let isCurrent = true;
    retryAttemptsRef.current = 0;
    setSource(null);
    setFailed(false);

    if (!isFocused) {
      return () => { isCurrent = false; };
    }

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
  }, [isFocused, mediaId]);

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

  function openViewer(): void {
    setZoom(1);
    setIsViewerOpen(true);
  }

  function closeViewer(): void {
    setZoom(1);
    setIsViewerOpen(false);
  }

  const viewerWidth = Math.max(240, windowWidth - 32) * zoom;
  const viewerHeight = Math.max(280, windowHeight - 150) * zoom;

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
    <>
      <Pressable
        accessibilityLabel={`${accessibilityLabel}. Abrir imagen ampliada`}
        accessibilityRole="button"
        onPress={openViewer}
        style={[style, styles.imageButton]}
      >
        <Image
          accessibilityLabel={accessibilityLabel}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
          onError={handleImageError}
        />
      </Pressable>
      <Modal
        visible={isViewerOpen}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerToolbar}>
            <Text style={styles.viewerTitle}>Evidencia privada</Text>
            <Pressable
              accessibilityLabel="Cerrar imagen ampliada"
              accessibilityRole="button"
              hitSlop={12}
              onPress={closeViewer}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              accessibilityLabel={accessibilityLabel}
              source={source}
              style={{ height: viewerHeight, width: viewerWidth }}
              resizeMode="contain"
            />
          </ScrollView>
          <View style={styles.zoomControls}>
            <Pressable
              accessibilityLabel="Reducir zoom"
              accessibilityRole="button"
              disabled={zoom <= 1}
              onPress={() => setZoom((value) => Math.max(1, value - 0.5))}
              style={[styles.zoomButton, zoom <= 1 && styles.zoomButtonDisabled]}
            >
              <Text style={styles.zoomButtonText}>−</Text>
            </Pressable>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
            <Pressable
              accessibilityLabel="Aumentar zoom"
              accessibilityRole="button"
              disabled={zoom >= 4}
              onPress={() => setZoom((value) => Math.min(4, value + 0.5))}
              style={[styles.zoomButton, zoom >= 4 && styles.zoomButtonDisabled]}
            >
              <Text style={styles.zoomButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
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
  imageButton: {
    overflow: "hidden",
  },
  viewerBackdrop: {
    backgroundColor: "rgba(13, 20, 18, 0.97)",
    flex: 1,
  },
  viewerToolbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  viewerTitle: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 18,
  },
  closeButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  closeButtonText: {
    color: COLORS.cream,
    fontSize: 28,
    fontWeight: "300",
    lineHeight: 30,
  },
  viewerContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: SPACING.md,
  },
  zoomControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    justifyContent: "center",
    paddingBottom: SPACING.xl,
  },
  zoomButton: {
    alignItems: "center",
    backgroundColor: COLORS.cream,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  zoomButtonDisabled: {
    opacity: 0.35,
  },
  zoomButtonText: {
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 24,
  },
  zoomLabel: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 12,
    minWidth: 42,
    textAlign: "center",
  },
});
