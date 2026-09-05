# Guía para agentes de IA

## Propósito y arquitectura

Este repositorio es un contenedor documental con dos aplicaciones independientes para un MVP de verificación de identidad: `backend/` contiene la API NestJS con Prisma y PostgreSQL; `frontend/` contiene la aplicación móvil Expo para Android e iOS. No es un workspace de Node ni debe tener un gestor de paquetes, `node_modules` o lockfile en la raíz.

## Límites de responsabilidad

- El backend es la autoridad para autenticación, transición de estados KYC, validación, persistencia y almacenamiento privado de imágenes.
- El frontend sólo captura el documento y la selfie con permiso explícito, consume la API y presenta el estado. No replica reglas de decisión ni almacena secretos.
- No cambie la lógica de negocio KYC ni los contratos de API sin una solicitud explícita y pruebas que cubran el cambio.

## Flujo KYC y estados

El flujo es `CREATED` → `DOCUMENT_UPLOADED` → `SELFIE_UPLOADED` → `VALIDATING`. Desde `VALIDATING`, el backend concluye en `APPROVED`, `REJECTED`, `NEEDS_REVIEW` o `PROCESSING_FAILED`; estos estados son terminales. La validación documental usa únicamente el proveedor configurado desde el backend (Gemini por defecto; Hugging Face sólo con selección explícita) y la comparación facial usa Human/TFJS locales. Si faltan assets, falla una comprobación de integridad, el proveedor devuelve un resultado inválido o no se puede procesar una imagen, el resultado debe fallar de forma cerrada, nunca aprobar por degradación.

### Evidencia documental por lado

La cédula se captura por ambos lados. Cada evidencia documental usa una etiqueta `FRONT`, `BACK` o `COMBINED`:

- `FRONT` y `BACK` son la vía por defecto (frente y reverso por separado).
- `COMBINED` agrupa ambos lados en una imagen y es excluyente: no puede coexistir con `FRONT` o `BACK`.
- Máximo una evidencia por lado; re-subir el mismo lado reemplaza la evidencia previa.
- Cobertura de fallo cerrado: front sin back, lado faltante o `COMBINED` incompleto terminan en `NEEDS_REVIEW`. La comparación facial usa únicamente `FRONT` o un `COMBINED` confirmado por el proveedor documental configurado; nunca `BACK`.

## Comandos por aplicación

Ejecute cada comando dentro de su carpeta; nunca desde la raíz.

```bash
# backend/
pnpm install
pnpm prisma:generate
pnpm test
pnpm build

# frontend/
bun install
bun run typecheck
bun test
```

La infraestructura del backend se conserva en `backend/infra/`. No ejecute Docker ni Docker Compose salvo petición explícita del usuario.

## Seguridad y PII

- Trate documentos, selfies, hashes, tokens, credenciales y resultados KYC como PII confidencial.
- No registre, exponga, copie a fixtures ni incluya PII o secretos en código, documentación, errores o variables `EXPO_PUBLIC_*`. Esto incluye `GEMINI_API_KEY` y `HUGGINGFACE_API_TOKEN`.
- Mantenga las imágenes en almacenamiento privado y conserve `KYC_DOCUMENT_HASH_PEPPER` separado de `JWT_SECRET`.
- Valide tamaño, dimensiones, tipo y contenido de los archivos en el backend antes de procesarlos.
- La imagen de la cédula se transmite al proveedor externo configurado; exija consentimiento informado y no almacene la respuesta OCR/PII cruda. La auditoría documental sólo conserva proveedor y modelo.
- El backend puede persistir únicamente los campos mínimos y tipados extraídos del documento para mostrarlos en el perfil del titular (`documentFullName`, `documentNumber`, `documentBirthDate`, `documentIssueDate`, `documentSex`, `documentHeight` y `documentCheckResult`), junto con el hash existente `documentNumberHash`. Persistirlos requiere solicitud o consentimiento explícito del usuario. La respuesta OCR cruda del proveedor nunca se almacena y estos campos no deben replicar reglas de decisión KYC.

## Capa de seguridad HTTP

El backend incluye una capa de seguridad HTTP global definida en `src/main.ts` (helmet) y en `src/common/` (throttler, filtro de excepciones y logger HTTP). Reglas operativas:

- No cambie la lógica de dominio ni el comportamiento de fallo cerrado del pipeline KYC.
- El rate limiting usa `@nestjs/throttler` con tres límites (general, `auth` y `kyc`) configurables por variables de entorno con prefijo `RATE_LIMIT_`. Los límites se leen desde `AppConfigService` y se aplican con decoradores/skip logic en `src/common/http/`. No desactive el throttling salvo en desarrollo.
- El logger HTTP nunca debe registrar cuerpos de petición (contraseñas, tokens), contenidos multipart ni cuerpos de respuesta (resultados KYC/PII); registra método, ruta, estado, duración e IP.
- El filtro de excepciones normaliza los errores a `{ statusCode, message, path, timestamp }` y no debe exponer stack traces en producción.
- Al añadir rutas o aplicar guards, mantenga coherente la clasificación de rutas de `src/common/http/route-kind.ts` (documentación, auth y kyc) para que el throttling y el logging sigan siendo correctos.

## IA documental, biometría local y prohibiciones

Gemini puede recibir únicamente la imagen de la cédula para extracción estructurada y validación documental mediante `KYC_DOCUMENT_PROVIDER=gemini`; su API key se conserva sólo en el backend. Hugging Face es una alternativa explícita mediante `KYC_DOCUMENT_PROVIDER=huggingface`, `HUGGINGFACE_API_TOKEN` backend-only y un modelo/proveedor concreto en `HUGGINGFACE_DOCUMENT_MODEL`; no use selectores automáticos de enrutamiento ni fallback. Ambos proveedores reciben sólo documentos normalizados etiquetados `FRONT`, `BACK` o `COMBINED`; la selfie nunca se transmite y la comparación facial continúa con Human/TFJS local. `local` es un modo explícito de desarrollo/pruebas, no un fallback. No añada telemetría de imágenes ni rutas de degradación que aprueben verificaciones. Está prohibido incorporar AWS o infraestructura AWS. No ejecute Docker, Docker Compose ni gestores de paquetes en la raíz sin una petición explícita.
