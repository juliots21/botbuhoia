# ia-buho v.1

Bot de WhatsApp con IA (Gemini) orientado a productos Digital Buho, con panel de administración web, persistencia en MySQL y scraper de catálogo comercial.

<img width="1353" height="635" alt="{18AC72C0-63A6-46B8-B8B2-CBDE14C8A44D}" src="https://github.com/user-attachments/assets/1fbe130c-3888-4021-ab39-628f90a57a13" />

## Estado del proyecto

- Backend: Node.js + Express
- IA: Google Gemini (con rotación de múltiples API keys y circuit breaker)
- Canal: WhatsApp Cloud API
- Persistencia: MySQL + archivos JSON locales
- Panel admin: Frontend estático servido por Express en la raíz
- Scraper de productos: Playwright + Cheerio + Axios

## Qué resuelve este sistema

- Atiende mensajes de clientes por WhatsApp en lenguaje natural.
- Procesa notas de voz de WhatsApp: transcribe audio con Gemini y responde automáticamente.
- Responde con contexto de conocimiento cargado desde data/knowledge.
- Mantiene memoria conversacional con ventana configurable por usuario/global.
- Permite tuning en caliente desde panel admin y API admin protegida por token.
- Registra trazabilidad de conversación en MySQL (chat mirror).
- Sincroniza catálogo comercial mediante scraping programado o manual.

<img width="883" height="512" alt="{CDBCF1E2-9715-483E-9FEF-26A9771A9D9B}" src="https://github.com/user-attachments/assets/a3789c76-ba31-4bbc-a194-a9754e093621" />

## Arquitectura funcional

1. Meta envía eventos al endpoint webhook.
2. El servidor valida firma HMAC (si hay META_APP_SECRET).
3. Bot handler aplica deduplicación + rate limiting + cola por usuario.
4. Se construye contexto (historial + conocimiento de productos).
5. Gemini genera respuesta.
6. WhatsApp service envía respuesta al usuario.
7. Se registran métricas y auditoría en MySQL.
8. El panel admin consulta health, usuarios, chat y configuración por API.

## Módulos clave

- server.js: bootstrap del servidor, middlewares, rutas, health y shutdown limpio.
- src/handlers/webhook.js: verificación GET de Meta y recepción de mensajes POST.
- src/handlers/bot_handler.js: pipeline principal del bot (texto/imagen/no soportados).
- src/services/gemini_service.js: invocación IA, control de keys, calidad de salida y continuidad.
- src/services/knowledge_loader.js: carga/índice semántico básico de JSON de conocimiento.
- src/services/whatsapp_service.js: envío de mensajes y descarga de media con reintentos.
- src/services/mysql_service.js: pool y health de base de datos.
- src/services/conversation_store_service.js: persistencia local y espejo en MySQL.
- src/services/buho_store_scheduler.js: cron del scraper de tienda.
- scrape_buho_store.js: extracción/actualización de planes y ciclos comerciales.
- public/: panel administrativo y vista chat espejo.

## Estructura resumida

- config.js
- server.js
- scrape_buho_store.js
- public/
- src/handlers/
- src/services/
- src/middleware/
- src/utils/
- data/knowledge/
- data/conversations/
- data/runtime/
- db/mysql/schema.sql
- logs/

## Requisitos

- Node.js 18+
- npm 9+
- MySQL 8+ (recomendado para producción)
- Credenciales de WhatsApp Cloud API
- API keys de Gemini

## Instalación

```bash
npm install
```

## Variables de entorno mínimas

Crear archivo .env en la raíz del proyecto.

```env
PORT=3000
NODE_ENV=development

# Gemini
GEMINI_API_KEY_1=
GEMINI_API_KEY_2=
GEMINI_API_KEY_3=
GEMINI_API_KEY_4=
GEMINI_TIMEOUT_MS=25000
GEMINI_TOTAL_TIMEOUT_MS=100000
GEMINI_MAX_ATTEMPTS=2

# WhatsApp / Meta
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WEBHOOK_VERIFY_TOKEN=
META_APP_SECRET=

# Admin API
ADMIN_API_TOKEN=
ADMIN_API_ALLOW_DEV_FALLBACK=true

# MySQL
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=

# Scraper
BUHO_STORE_SCRAPER_ENABLED=true
BUHO_STORE_SCRAPER_CRON=0 3 * * *
BUHO_STORE_SCRAPER_TZ=America/Lima
```

## Base de datos

Importar esquema inicial:

- Archivo: db/mysql/schema.sql
- Crea tablas de usuarios, configuración runtime, sesiones, mensajes, métricas y eventos.

## Ejecución

Modo normal:

```bash
npm start
```

Modo desarrollo:

```bash
npm run dev
```

Scraper manual completo:

```bash
npm run scrape:store
```

Scraper filtrado por producto:

```bash
# PowerShell
$env:SCRAPE_ONLY='fastura_colombia'; node scrape_buho_store.js
```

## Endpoints principales

- GET /health: estado, métricas y servicios.
- GET /webhook: verificación con Meta.
- POST /webhook: entrada de mensajes/eventos.
- GET /api/config: configuración actual (requiere token admin).
- PUT /api/config: actualización hot-reload (requiere token admin).
- GET /api/users: lista de usuarios detectados.
- GET /api/users/:phone/config: configuración efectiva por usuario.
- PUT /api/users/:phone/config: actualización por usuario.
- GET /api/chat/:phone: historial de chat espejo.
- GET /api/chat/:phone/count: conteo de mensajes.

## Soporte de audio (WhatsApp -> Gemini -> Respuesta)

- El webhook detecta mensajes de tipo audio y los enruta al pipeline dedicado.
- Se descarga el archivo de voz desde WhatsApp Cloud API en base64.
- Gemini transcribe el audio a texto.
- El texto transcrito entra al mismo flujo conversacional del bot para generar respuesta.
- Se guarda auditoría en MySQL como inbound transcrito y outbound del bot.

MIME objetivo recomendado desde WhatsApp:

- audio/ogg
- audio/ogg; codecs=opus
- audio/mpeg
- audio/mp3
- audio/wav
- audio/webm
- audio/mp4
- audio/aac

## Seguridad

- Webhook con validación HMAC SHA-256 usando header X-Hub-Signature-256.
- API admin protegida por token (Authorization Bearer o X-Admin-Token).
- En desarrollo, existe fallback de token admin si no está configurado ADMIN_API_TOKEN.

## Persistencia y memoria

- Historial corto en memoria con ventana configurable.
- Persistencia local de historial en data/conversations/chat_history.json.
- Deduplicación y rate limiter persistidos en data/runtime.
- Auditoría de mensajes inbound/outbound en MySQL.

## Scraper de catálogo

- Origen principal: páginas comerciales de buho.la y fuentes adicionales.
- Actualiza archivos JSON en data/knowledge.
- Puede extraer ciclos de facturación directamente desde carrito/configuración.
- Scheduler opcional vía cron interno.

## Captura del panel admin/chat

La siguiente captura fue tomada en:

- URL: https://testing21.alwaysdata.net/#chat/51986079838
- Contexto: acceso de administración con token provisto para esta tarea.

<img width="746" height="439" alt="image" src="https://github.com/user-attachments/assets/0bf957aa-6217-42eb-8895-5c9a7776de15" />


## Script de captura usado

Se agregó un script utilitario para capturas automatizadas con Playwright:

- scripts/capture_admin_chat_screenshot.js

Ejecución:

```bash
node scripts/capture_admin_chat_screenshot.js
```

## Observaciones operativas

- Si MySQL no está configurado, el bot sigue funcionando en modo parcial (sin chat mirror persistente).
- Si no hay token WhatsApp, el servicio entra en modo simulado para envío.
- El comando newchatgg reinicia contexto conversacional del usuario.
- Recomendado revisar periódicamente logs/ y métricas de /health.

## Licencia

Uso interno del proyecto ia-buho v.1. Ajustar sección de licencia según política de distribución de Digital Buho.
