# Kora KYC

Kora KYC es una prueba técnica que presenta un MVP móvil de verificación de identidad. Permite que una persona cree una sesión, se autentique, capture su cédula y una selfie, y reciba un resultado de validación documental mediante un proveedor configurado en backend y comparación facial local. El objetivo es mostrar una base técnica clara para un flujo KYC, no sustituir una plataforma de cumplimiento normativo ni un proveedor de identidad de producción.

## Alcance del MVP

El problema abordado es la verificación inicial de identidad en una aplicación móvil con una integración documental externa controlada desde el backend y sin infraestructura AWS. El MVP cubre captura guiada, extracción estructurada de documento, comparación facial local, persistencia del caso y consulta de su resultado.

Quedan fuera del alcance la prueba de vida, la detección de suplantación, la autenticidad documental certificada y la decisión regulatoria final.

## Capacidades principales

- Registro e inicio de sesión mediante una API autenticada con JWT.
- Creación y seguimiento de un caso KYC por usuario.
- Captura de la cédula por ambos lados (frente y reverso) con cámara trasera y selfie con cámara frontal.
- Extracción estructurada y validación documental de cédulas mediante un proveedor configurado exclusivamente en el backend.
- Detección facial, generación de embeddings y comparación facial locales.
- Estados explícitos del proceso y resultado consultable desde el perfil.
- Almacenamiento privado de imágenes y validaciones de archivos antes de procesarlos.
- Documentación de la API autoservida con Scalar sobre el esquema OpenAPI del backend.
- Procesamiento de fallo cerrado: una evidencia, modelo o procesamiento inválido no puede producir una aprobación.

## Arquitectura general

```text
Usuario
  │
  ▼
Aplicación móvil Expo (Android / iOS)
  ├── Registro, inicio de sesión y perfil
  ├── Captura de cédula (frente y reverso) y selfie con permiso de cámara
  └── Consulta del estado y resultado KYC
  │ HTTPS / API autenticada con JWT
  ▼
Backend NestJS
  ├── Autenticación, autorización y propiedad por usuario
  ├── Orquestación de estados KYC y validación de archivos
  ├── Almacenamiento privado de imágenes
   ├── Proveedor documental configurado para extracción estructurada
  ├── Detección y embeddings faciales con Human/TFJS o face_service
  └── Prisma
  │
  ▼
PostgreSQL
  └── Usuarios, casos KYC, estados y resultados
```

La aplicación móvil captura y presenta información; el backend es la autoridad para autenticación, reglas de transición, procesamiento, persistencia y protección de los archivos.

## Estructura del repositorio

```text
.
├── README.md              # Presentación, alcance y ruta de revisión del repositorio
├── AGENTS.md              # Reglas operativas y límites para agentes de IA
├── backend/               # API NestJS, Prisma, PostgreSQL e IA local
│   └── infra/             # Artefactos de infraestructura del backend
└── frontend/              # Aplicación Expo para Android e iOS
```

La raíz es un punto de documentación y coordinación, no un workspace de Node.js. Cada aplicación gestiona sus dependencias y comandos de manera independiente dentro de su propio directorio.

## Flujo de usuario KYC

1. **Sesión:** la persona abre la aplicación y accede al flujo de autenticación.
2. **Registro o inicio de sesión:** crea una cuenta o inicia sesión; la API emite el JWT que autoriza las solicitudes posteriores.
3. **Inicio del caso:** la persona crea un caso KYC, inicialmente en estado `CREATED`.
4. **Captura de cédula:** concede permiso de cámara, captura el frente de la cédula, luego el reverso, y los carga; si el backend acepta los archivos el caso pasa a `DOCUMENT_UPLOADED`.
5. **Captura de selfie:** captura la selfie con la cámara frontal; el caso pasa a `SELFIE_UPLOADED`.
6. **Procesamiento:** el backend inicia la validación en `VALIDATING`, valida la respuesta estructurada del proveedor documental configurado para la cédula y ejecuta detección facial y comparación facial local.
7. **Estados finales:** el proceso concluye en `APPROVED`, `REJECTED`, `NEEDS_REVIEW` o `PROCESSING_FAILED`. Todos son terminales.
8. **Resultado y perfil:** la aplicación consulta el estado y presenta el resultado del caso en el perfil de la persona autenticada.

## Procesamiento documental, IA local y comportamiento de fallo cerrado

El procesamiento de identidad se realiza en el backend con componentes documentales externos y biometría local:

| Componente | Responsabilidad |
|---|---|
| Proveedor documental configurado | Extrae campos estructurados y evalúa la legibilidad documental de la cédula mediante una credencial exclusiva del backend. Gemini permanece como predeterminado; Hugging Face exige selección y configuración explícitas. |
| Human con TensorFlow.js | Detecta rostros y genera embeddings faciales. |
| Comparación facial | Compara los embeddings del documento y la selfie según la configuración del backend. |

La imagen de la cédula se transmite únicamente al proveedor documental configurado. La selfie no se transmite a ese proveedor y permanece en la comparación facial local. La persona debe otorgar consentimiento informado visible o contractual antes del envío; el texto debe describir “proveedor documental configurado” sin prometer condiciones de retención. La operación debe evaluar los requisitos aplicables de privacidad y transferencia de datos. Las credenciales se configuran sólo en `backend/.env` o en el gestor seguro de secretos; nunca llegan al frontend, logs, base de datos o respuestas HTTP. `KYC_DOCUMENT_PROVIDER=gemini` mantiene Gemini como opción predeterminada, `KYC_DOCUMENT_PROVIDER=huggingface` exige token y modelo/proveedor explícitos, y `KYC_DOCUMENT_PROVIDER=local` habilita Tesseract sólo de forma explícita para desarrollo o pruebas. Consulte la [guía del backend](./backend/README.md) para el procedimiento de activación seguro.

Los assets de Human/TFJS se preparan mediante el backend y se validan con un manifiesto de checksums. Si falta un asset, su integridad no es válida, el proveedor documental devuelve una respuesta inválida, una imagen no puede procesarse o una comprobación requerida falla, el caso termina como error o resultado no aprobatorio. No existe una ruta de degradación que apruebe el caso automáticamente.

El face matching es local por defecto (Human/TFJS) y puede delegarse a `face_service` según la configuración del backend. No implementa liveness, detección anti-spoofing ni una aprobación biométrica certificada. Ningún proveedor documental se usa para aprobar biometría facial.

## Seguridad y privacidad

- La autenticación usa JWT; cada operación KYC se autoriza en el backend.
- Los casos y sus archivos pertenecen al usuario autenticado; no deben exponerse entre usuarios.
- Las imágenes de documentos y selfies se conservan en almacenamiento privado, sin rutas públicas de descarga.
- El backend valida tamaño, dimensiones, tipo declarado y contenido mediante magic bytes antes de procesar archivos.
- Documentos, selfies, hashes, tokens, credenciales y resultados KYC se tratan como PII confidencial y no deben registrarse en logs.
- La procedencia documental almacena sólo proveedor y modelo; no almacena credenciales, OCR ni PII crudo devuelto por el proveedor documental.
- `KYC_DOCUMENT_HASH_PEPPER` es un secreto independiente de `JWT_SECRET`.
- El almacenamiento local es apropiado para el MVP y para entornos controlados; no reemplaza una política formal de retención, borrado, respaldo, cifrado gestionado o respuesta a incidentes.

## Capa de seguridad HTTP

El backend aplica una capa de seguridad defensiva sin cambiar la lógica de dominio KYC:

- **Helmet**: cabeceras HTTP seguras globales con una Content-Security-Policy controlada que permite servir la documentación autoservida (Scalar `/docs` y Swagger `/api`).
- **Rate limiting** (`@nestjs/throttler`): tres límites independientes y configurables, con límite estricto en los endpoints públicos de autenticación, límite moderado en las subidas KYC y límite general para el resto. La documentación no se limita. Al superar un límite se responde `429` con `Retry-After`.
- **Logging y filtro de errores**: un logger HTTP registra método, ruta, estado, duración e IP sin cuerpos, multipart ni respuestas; un filtro de excepciones central devuelve un JSON consistente sin exponer stack traces ni detalle interno en producción.

Estos controles reemplazan la ausencia previa de rate limiting y HTTP hardening en el MVP. Los detalles, las variables de entorno y cómo probar el `429` están documentados en el [README del backend](./backend/README.md).

## Stack técnico

| Área | Tecnología | Motivo |
|---|---|---|
| API | NestJS con TypeScript | Estructura modular para autenticación, validación y orquestación KYC. |
| Persistencia | Prisma y PostgreSQL | Modelo de datos tipado y persistencia relacional de usuarios y casos. |
| Dependencias del backend | pnpm | Instalación aislada y reproducible dentro de `backend/`. |
| Cliente móvil | Expo managed con React Native | Una aplicación móvil para Android e iOS con acceso a cámara. |
| Ejecución del frontend | Bun | Gestor y entorno definidos para `frontend/`. |

El frontend no incluye destino web. La prueba se enfoca en Android e iOS.

## Inicio rápido

Ejecute los comandos desde el directorio de cada aplicación; no instale dependencias ni ejecute gestores de paquetes en la raíz.

1. Consulte el [README del backend](./backend/README.md) para requisitos, variables de entorno, assets locales, generación de Prisma, migraciones e inicio de la API.
2. Consulte el [README del frontend](./frontend/README.md) para Bun, configuración de `EXPO_PUBLIC_API_URL`, permisos de cámara y ejecución en Android o iOS.
3. En un dispositivo físico, configure una URL de API alcanzable desde el dispositivo; no use `localhost`.

## Verificación realizada

Se verificaron los siguientes comandos en sus directorios correspondientes:

| Área | Verificaciones realizadas |
|---|---|
| Backend | Tests, compilación y generación del cliente Prisma. |
| Frontend | Tests y comprobación de tipos. |

Docker y Docker Compose no se ejecutaron como parte de esta entrega por decisión del usuario. La infraestructura permanece documentada en `backend/infra/`, pero no forma parte de la evidencia de ejecución de esta prueba.

## Limitaciones honestas del MVP

- No implementa liveness ni detección anti-spoofing.
- No verifica la autenticidad documental ante una fuente oficial ni detecta fraudes documentales de forma certificada.
- No define una política formal de retención, eliminación o conservación de evidencia.
- No se realizó una prueba de integración end-to-end con PostgreSQL en esta ejecución.
- Las pruebas disponibles no sustituyen una validación de integración completa del controlador, el worker y la base de datos.

## Guion breve para una demo de entrevista

1. Presentar el problema: una validación de identidad móvil con proveedor documental configurable, biometría local y controles explícitos de privacidad.
2. Registrar una cuenta o iniciar sesión y crear un caso KYC.
3. Mostrar la captura guiada de la cédula y la selfie, incluyendo el permiso de cámara.
4. Explicar la transición de estados, la extracción documental exclusivamente en backend con proveedor explícitamente configurado y los embeddings faciales locales.
5. Consultar el resultado desde el perfil y destacar que el backend impone la propiedad por usuario y el comportamiento de fallo cerrado.
6. Cerrar con los límites del MVP y las mejoras requeridas para un entorno productivo.

## Siguientes mejoras priorizadas

1. Incorporar pruebas de integración con PostgreSQL y pruebas end-to-end del flujo móvil a la API.
2. Profundizar observabilidad segura, supervisión de límites y una política formal de retención y borrado de PII.
3. Implementar liveness y controles anti-spoofing con evaluación de seguridad y sesgos.
4. Integrar verificación documental con fuentes autorizadas y revisión manual auditable cuando corresponda.
5. Definir cifrado, gestión de claves, respaldo y respuesta a incidentes para una operación productiva.

## Documentación específica

- [Guía del backend](./backend/README.md)
- [Guía del frontend](./frontend/README.md)
- [Reglas para agentes de IA](./AGENTS.md)
