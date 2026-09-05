# Frontend Kora KYC

Aplicación móvil Expo managed para Android e iOS. Captura el documento y la selfie con autorización del usuario y consulta el estado KYC en el backend.

## Gestor y configuración

Use Bun 1.3.10. El gestor está declarado en `package.json`; no use npm ni instale dependencias desde la raíz.

```bash
bun install
EXPO_PUBLIC_API_BASE_URL=http://192.168.2.8:3000 bun run android
```

Para iOS:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.2.8:3000 bun run ios
```

También puede iniciar Expo con `EXPO_PUBLIC_API_BASE_URL=http://192.168.2.8:3000 bun start`. En un dispositivo físico, sustituya `192.168.2.8` por la dirección IPv4 local de la computadora que ejecuta el backend si es diferente; la URL debe ser alcanzable desde el dispositivo y no debe usar `localhost`. Después de cambiar `.env`, reinicie Expo para que vuelva a cargar las variables públicas. Nunca incluya secretos en variables `EXPO_PUBLIC_*`.

## Cámara

La aplicación solicita el permiso de cámara cuando el flujo necesita capturar un documento o una selfie. El usuario debe aceptarlo o habilitarlo en los ajustes del sistema si lo rechazó. Use la cámara trasera para el documento y la frontal para la selfie cuando la pantalla lo indique.

## Identidad de la aplicación

Los assets propios de Kora están en `assets/`:

- `image.png`: único asset válido de identidad, usado como icono principal, primer plano del icono adaptativo de Android, splash y marca visible dentro de la aplicación.

La configuración nativa está centralizada en `app.json`. Antes de publicar, revise `expo.name`, `expo.slug`, `expo.version`, `expo.scheme`, `ios.bundleIdentifier` y `android.package`. Mantenga los identificadores definitivos antes de distribuir una compilación: cambiarlos después crea aplicaciones distintas en App Store y Google Play.

Para cambiar el icono o splash, reemplace `assets/image.png`, conserve la ruta declarada en `app.json` y ejecute una validación sin generar proyectos nativos:

```bash
bunx expo config --type public
```

El splash usa `#07110F`, el mismo color base de la interfaz oscura de Kora. La imagen `assets/image.png` es RGBA de 1080 × 1082 y su verde dominante `#00DB90` define el acento de la interfaz. La fuente Inter se incluye en la aplicación mediante `@expo-google-fonts/inter` y se carga antes de mostrar la navegación. La descripción de cámara de iOS y el plugin de cámara están configurados en español.

## Verificación

```bash
bun run typecheck
bun test
bun audit
```

La aplicación no incluye destino web ni infraestructura Docker. Las reglas de decisión y el tratamiento de imágenes pertenecen al backend.

## Auditoría de dependencias

La auditoría ejecutada con `bun audit` mantiene 8 hallazgos transitivos: 4 altos y 4 moderados. Corresponden a `decode-uri-component` a través de React Navigation, `image-size` a través de React Native/Metro, `postcss` y `uuid` a través de Expo. `bun update` no encontró actualizaciones compatibles. La corrección exige actualizar la cadena Expo/React Native a una versión que incorpore los parches; no se usaron actualizaciones mayores ni forzadas sin una validación de compatibilidad móvil.
