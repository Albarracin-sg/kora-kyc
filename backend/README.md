# Backend Kora KYC

API NestJS para el MVP KYC, con Prisma, PostgreSQL, almacenamiento privado de imágenes, proveedor documental configurable y comparación facial configurable (local o `face_service`).

## Arquitectura

Dos aplicaciones independientes: `backend/` (API NestJS con Prisma y PostgreSQL; autoridad para autenticación, transición de estados KYC, validación, persistencia y almacenamiento privado de imágenes) y `frontend/` (app Expo que captura documento y selfie con permiso explícito, consume la API y presenta el estado; sin reglas de decisión ni secretos). La infraestructura se conserva en `backend/infra/`.

El flujo KYC es `CREATED` → `DOCUMENT_UPLOADED` → `SELFIE_UPLOADED` → `VALIDATING` y concluye en `APPROVED`, `REJECTED`, `NEEDS_REVIEW` o `PROCESSING_FAILED` (terminales). Todas las decisiones siguen el comportamiento fail-closed: ante assets faltantes, comprobación de integridad fallida, respuesta inválida del proveedor o imagen no procesable, el resultado nunca aprueba por degradación.

Los proveedores se seleccionan por variables de entorno:

- **Documental** (`KYC_DOCUMENT_PROVIDER`): `gemini` (predeterminado), `huggingface` (explícito) o `local` (sólo desarrollo/pruebas). Una única llamada al modelo configurado; sin selectores de enrutamiento ni fallback.
- **Facial** (`FACE_VERIFICATION_PROVIDER`): `local` (Human/TFJS, predeterminado) o `face_service` (servicio FastAPI con InsightFace, véase "Activación de face_service").

## Gestor y requisitos

Use Node.js 24 y pnpm 11.3.0. El gestor está declarado en `package.json`; no use npm ni instale dependencias desde la raíz del repositorio. `pnpm-workspace.yaml` no define un workspace: sólo permite los scripts de instalación necesarios para los binarios locales de Prisma, TensorFlow, bcrypt, esbuild y Tesseract.

```bash
pnpm install
cp .env.example .env
pnpm assets:bootstrap
pnpm prisma:generate
pnpm prisma:migrate -- --name init
pnpm start:dev
```

`DATABASE_URL` debe apuntar a PostgreSQL. Antes de usar datos reales, reemplace todos los valores de ejemplo, especialmente `JWT_SECRET`, `KYC_DOCUMENT_HASH_PEPPER`, las credenciales del proveedor documental y las credenciales de base de datos.

## Variables y Prisma

`.env.example` documenta las variables de puerto, base de datos, JWT, CORS, almacenamiento privado, assets locales, proveedor documental y umbrales KYC. `KYC_DOCUMENT_HASH_PEPPER` es un secreto independiente del JWT. Genere el cliente Prisma antes de compilar o ejecutar la API:

```bash
pnpm prisma:generate
pnpm prisma:migrate -- --name descripcion-del-cambio
```

## Proveedor documental configurable, modelos locales y comportamiento fail-closed

### Evidencia documental por lado

El flujo KYC captura la cédula colombiana por ambos lados. Cada evidencia documental se etiqueta con `FRONT`, `BACK` o `COMBINED`:

- `FRONT` y `BACK` son la vía por defecto: se capturan el frente y el reverso de la cédula por separado.
- `COMBINED` agrupa ambos lados en una única imagen y es excluyente: no puede coexistir con `FRONT` o `BACK`.
- Se admite como máximo una evidencia por lado; re-subir el mismo lado reemplaza la evidencia previa.

El backend aplica cobertura de fallo cerrado antes de cualquier decisión: si se captura `FRONT` sin `BACK`, si falta un lado, o si una imagen `COMBINED` no contiene ambos lados legibles, el caso termina en `NEEDS_REVIEW`. La comparación facial usa exclusivamente la imagen `FRONT`, o la imagen `COMBINED` confirmada por el proveedor documental configurado con ambos lados presentes; nunca usa `BACK`.

### Extracción documental y activación del proveedor

Gemini es el proveedor documental predeterminado y `.env.example` lo declara explícitamente. Configure `KYC_DOCUMENT_PROVIDER=gemini` y establezca `GEMINI_API_KEY` sólo en `backend/.env` o en el gestor seguro de secretos del entorno. Nunca use variables `EXPO_PUBLIC_*`, no envíe la credencial al frontend y no la registre en logs, base de datos ni respuestas HTTP. `GEMINI_MODEL` permite fijar el modelo, con `gemini-2.5-flash` como valor por defecto.

Para activar Hugging Face después del merge, el operador debe: (1) crear y guardar `HUGGINGFACE_API_TOKEN` exclusivamente en el gestor seguro de secretos del backend o en `backend/.env`; (2) establecer `HUGGINGFACE_DOCUMENT_MODEL` con un modelo y proveedor explícitos, por ejemplo `Qwen/Qwen2.5-VL-72B-Instruct:ovhcloud`; (3) fijar `KYC_DOCUMENT_PROVIDER=huggingface`; (4) opcionalmente ajustar `HUGGINGFACE_DOCUMENT_TIMEOUT_MS` entre 1000 y 120000 milisegundos (30000 por defecto); y (5) reiniciar la API. No use los selectores de enrutamiento `:fastest`, `:cheapest` ni `:preferred`, y no configure un fallback: cada solicitud usa una única llamada al modelo configurado.

El backend envía al proveedor documental configurado únicamente las imágenes JPEG normalizadas de cédula etiquetadas por lado (`FRONT`, `BACK` o `COMBINED`), con un contrato JSON Schema estricto y validación semántica local compartida por los proveedores. La selfie nunca se transmite al proveedor documental: se lee por separado y permanece en la comparación facial local. El backend espera además de los campos extraídos los indicadores `frontPresent` y `backPresent` para confirmar qué lados llegaron legibles. La auditoría persiste únicamente la procedencia mínima del procesamiento documental (proveedor y modelo), nunca credenciales ni el texto OCR o PII crudo de la respuesta del modelo.

El MVP no implementa una UI ni un registro de consentimiento. Antes de habilitar cualquier proveedor documental externo, el operador debe incorporar y obtener consentimiento informado visible o contractual con un texto equivalente a: “Su documento de identidad será enviado al proveedor documental configurado para la extracción y validación documental. La selfie no se transmite a ese proveedor y se usa sólo para la comparación facial: local por defecto o, si el operador activa `FACE_VERIFICATION_PROVIDER=face_service`, hacia el servicio local de comparación facial.” No asuma ni invente consentimiento silencioso; evalúe con asesoría competente las obligaciones aplicables de privacidad y transferencia de datos.

`KYC_DOCUMENT_PROVIDER=local` mantiene Tesseract como modo explícito para desarrollo y pruebas; no es un fallback automático si falla un proveedor externo. `pnpm assets:bootstrap` descarga el OCR en español y copia los modelos locales de detección y comparación facial. Genera `assets/manifest.json`; el backend valida sus checksums.

Cuando `FACE_VERIFICATION_PROVIDER` no está configurado como `face_service`, la detección, embeddings y comparación facial corren en proceso con Human/TFJS. Con `face_service`, la comparación se delega al servicio local descrito abajo. En ambos modos no son liveness, detección anti-spoofing ni una aprobación biométrica certificada. La ausencia, modificación o error de un asset, una respuesta inválida o cualquier fallo del proveedor termina el trabajo KYC como `PROCESSING_FAILED`; no existe aprobación local automática.

### Activación de face_service (comparación facial delegada)

Por defecto la comparación facial es local con Human/TFJS. Para delegarla al servicio `backend/face-service` (FastAPI con InsightFace, pensado para ejecutarse en la misma máquina o en una red privada), el operador debe:

1. Levantar el servicio siguiendo `backend/face-service/README.md` (por ejemplo, en el entorno del servicio: `uvicorn app.main:app --host 127.0.0.1 --port 8000`).
2. Configurar en `backend/.env` (valores por defecto en `.env.example`, validados por `AppConfigService`):
   - `FACE_VERIFICATION_PROVIDER=face_service` (dominio: `local` o `face_service`).
   - `FACE_SERVICE_URL` (por defecto `http://localhost:8000`).
   - `FACE_SERVICE_TIMEOUT_MS` (por defecto `30000`).
3. Reiniciar la API.

Semántica: el backend envía al face-service únicamente la imagen `FRONT` (o la `COMBINED` confirmada por el proveedor documental con ambos lados) junto con la selfie; nunca `BACK`. El servicio devuelve similaridad coseno y calidad de imagen, y el worker aplica los umbrales KYC configurables (`KYC_FACE_MIN_SIMILARITY`, `KYC_FACE_MAX_DISTANCE`, `KYC_FACE_MIN_CONFIDENCE`). Ante timeout, error de red, respuesta inválida o calidad insuficiente, el flujo falla cerrado (`NEEDS_REVIEW` o `PROCESSING_FAILED`) y nunca aprueba por degradación. En este modo la selfie se transmite al servicio local de comparación: consérvelo en la red controlada e inclúyalo en el texto de consentimiento informado.

## Documentación de la API (OpenAPI y Scalar)

El backend documenta su API con OpenAPI mediante `@nestjs/swagger`. Una vez iniciado, el esquema JSON está disponible en `/api-json` y la referencia interactiva de Scalar en `/docs` (además de Swagger UI en `/api`). Los controladores de Auth, Users y KYC incluyen etiquetas, descripción y códigos de respuesta. Levante la API y abra `/docs` para explorar y probar los endpoints.

## Capa de seguridad HTTP

El backend aplica tres controles defensivos sin cambiar la lógica de dominio:

### Helmet (cabeceras HTTP seguras)

Se aplica `helmet` globalmente en `src/main.ts` con una CSP controlada. La API devuelve JSON, no HTML, de modo que la CSP sólo afecta a la documentación autoservida: permite `self` más el host `https://cdn.jsdelivr.net` (que Scalar usa para su renderer) y estilos `unsafe-inline` exclusivos para las UIs de documentación. Swagger UI sirve sus assets desde el mismo origen. Los clientes móviles nativos no interpretan CSP, por lo que el tráfico JSON no se ve afectado por esta directiva.

### Rate limiting (`@nestjs/throttler`)

Un throttler global divide el tráfico en tres límites independientes, cada uno configurable por variable de entorno con valores por defecto sensatos:

| Límite | Rutas | Por defecto | Variables |
|---|---|---|---|
| `default` | REST general (perfil de usuario) | 100 peticiones / 60 s | `RATE_LIMIT_DEFAULT_LIMIT`, `RATE_LIMIT_DEFAULT_TTL_MS` |
| `auth` | `POST /auth/register` y `/login` | 10 peticiones / 60 s, bloqueo 300 s | `RATE_LIMIT_AUTH_LIMIT`, `RATE_LIMIT_AUTH_TTL_MS`, `RATE_LIMIT_AUTH_BLOCK_MS` |
| `kyc` | subidas de documento y selfie | 30 peticiones / 60 s, bloqueo 120 s | `RATE_LIMIT_KYC_LIMIT`, `RATE_LIMIT_KYC_TTL_MS`, `RATE_LIMIT_KYC_BLOCK_MS` |

- El límite estricto de `auth` frena fuerza bruta y abuso sobre los endpoints públicos.
- El límite moderado de `kyc` evita subidas repetidas sin romper flujos legítimos. El rastreo es por IP (método práctico: los guards globales corren antes que el guard JWT, por lo que todavía no hay usuario autenticado al limitar).
- La documentación (`/docs`, `/api`, `/api-json`) no se limita. Los guiones `skipIf` garantizan que cada petición se cuente una sola vez contra el límite que le corresponde.
- Al superar un límite se responde `429 Too Many Requests` con la cabecera `Retry-After` y las cabeceras estándar `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`.
- `RATE_LIMIT_ENABLED=false` desactiva todo el throttling (útil en desarrollo).

Para ajustar los límites, edite las variables de `backend/.env` (copie las nuevas líneas de `.env.example`) y reinicie la API.

#### Cómo probar el 429

Con la API levantada, supere el límite del endpoint de login. Por ejemplo, con límite por defecto de 10 peticiones/60 s, dispare más intentos en una ventana corta:

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"a@example.com","password":"x"}'
done
```

Las primeras peticiones devuelven estados normales (`200`/`401`) y las siguientes `429` con la cabecera `Retry-After`. La documentación y las rutas generales no deberían devolver `429` durante esta prueba. Puede reducir temporalmente `RATE_LIMIT_AUTH_LIMIT` a un valor bajo para observar el efecto más rápido.

### Logging y filtro de errores central

- **HTTP logger**: se registran método, ruta, código de estado, duración, IP y (cuando existe) el id de usuario. Nunca se registran cuerpos de petición (contraseñas, tokens), contenido multipart ni cuerpos de respuesta (resultados KYC/PII). Los assets estáticos de la documentación se omiten para mantener los logs centrados en tráfico de aplicación.
- **Filtro de excepciones**: normaliza los errores a `{ statusCode, message, path, timestamp }`. No expone stack traces ni detalles internos en producción; los errores desconocidos devuelven `500 Internal server error` genérico. No filtra PII.

Los errores de dominio KYC no cambiaron y el pipeline mantiene su comportamiento de fallo cerrado. La autenticación sigue siendo per-controlador (`JwtAuthGuard` en Users y KYC; los endpoints de Auth permanecen públicos), sin aplicar un guard JWT global para no alterar el comportamiento existente.

## Infraestructura

Los archivos de infraestructura están en `infra/`. Cuando se solicite ejecutar Docker, hágalo desde esa carpeta para que el contexto de construcción sea `backend/` y Compose tome `backend/.env`:

```bash
cd infra
cp ../.env.example ../.env
docker compose --env-file ../.env up --build
```

`backend/.dockerignore` permanece en la raíz del contexto de construcción (`backend/`), que es donde Docker lo evalúa. Excluye dependencias, secretos, datos privados y artefactos generados del contexto sin ocultarlos de Git.

## Verificación y límites del MVP

```bash
pnpm test
pnpm build
pnpm prisma:generate
pnpm audit
```

El MVP conserva imágenes fuera de exposición pública. No sustituye revisión regulatoria, pruebas de vida certificadas ni un proveedor de identidad de producción.

## Auditoría de dependencias

Se resolvieron las 14 vulnerabilidades transitivas que afectaban al MVP mediante un bloque `overrides` declarado en `pnpm-workspace.yaml` (no en `package.json`: pnpm 11 dejó de leer configuraciones del campo `pnpm` y los overrides deben declararse en el archivo de workspace). Las versiones efectivas pasaron de `tar@6.2.1` a `tar@7.5.22`, de `adm-zip@0.5.18` a `adm-zip@0.6.0` y de `deepmerge-ts@7.1.5` a `deepmerge-ts@8.0.2`. Se verificó el estado final con `pnpm prisma:generate`, `pnpm build` y `pnpm test` (24 pruebas en 5 suites, todas en verde) y `pnpm audit` reporta cero hallazgos en todas las severidades.

Las rutas afectadas quedaron: `tar` proviene de `@tensorflow/tfjs-node` (directa y vía `@mapbox/node-pre-gyp`) y de `bcrypt` vía `@mapbox/node-pre-gyp`; `adm-zip` de `@tensorflow/tfjs-node`; y `deepmerge-ts` de Prisma (`@prisma/client` y `prisma`). Los saltos mayores de `tar` y `adm-zip` conservan la extracción nativa: los binarios de `bcrypt` y `tfjs-node` se reconstruyeron y cargan correctamente con la nueva versión de `tar`.

Nota: en este entorno (Node v24) `tfjs-node@4.22.0` presenta una incompatibilidad preexistente en su capa JS con la API `util.isNullOrUndefined` (eliminada de Node 24), observable al ejecutar tensores con `dataSync()`. Es un problema de versión del runtime de Node, independiente del override de `tar`, y no se aborda en esta tarea de seguridad. Se recomienda fijar la versión de Node o actualizar TensorFlow como trabajo separado antes del despliegue.
