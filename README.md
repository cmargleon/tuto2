# Auto2 MVP local

MVP local en `Node.js + Express + TypeScript` para generar y revisar fotos de catalogo desde carpetas locales, usando `fal.ai` y la API oficial de OpenAI para imagenes, dejando el proveedor encapsulado para poder cambiarlo despues.

## Decision tecnica documentada

Este repo ya no usa Gemini ni Vertex AI. El proyecto soporta `fal.ai` y OpenAI oficial para modelos de imagen.

Decision actual del provider:

- Proveedores soportados:
  - `fal.ai` via `@fal-ai/client` y `fal.subscribe(...)`
  - OpenAI oficial via `POST /v1/images/edits`
- Modelo por defecto configurable: `fal-ai/bytedance/seedream/v4.5/edit`
- Modelo OpenAI soportado en el selector: `gpt-image-1.5`
- Entrada multimodal usada: `prompt + image_urls`
- Transporte de imagenes de entrada: `Data URI base64`
- Salida esperada: `images[].url`
- Postproceso local: `Sharp` para adaptar la salida final a `1000x1000 JPG` y `72 ppp`

Por que esta decision:

- `fal.ai` encaja bien para composicion multimodal con multiples imagenes.
- OpenAI oficial se usa directamente cuando eliges un modelo `gpt-image-*` en el selector.
- La interfaz interna del proyecto no cambia: solo cambia el adapter.

Limitaciones reales documentadas en este MVP:

- No se promete `identity lock` perfecto del modelo.
- No se promete `virtual try-on` exacto ni conservacion perfecta de la prenda pixel a pixel.
- La pose de referencia se usa como guia, no como garantia exacta.
- No se garantiza perfil `Adobe RGB`. El MVP guarda JPEG estandar procesado con `Sharp`.
- El resultado final se normaliza localmente a `1000x1000`.
- El endpoint de edicion de Seedream 4.5 admite hasta `10` imagenes de entrada; si excedes eso, el provider lanza error explicito.
- Si OpenAI rechaza un `modelId` concreto, el error se devuelve tal cual desde la API oficial.

## Arquitectura

```text
/src
  /server
    app.ts
    routes/
    controllers/
    services/
    providers/
    jobs/
    storage/
    utils/
  /client
    /public
    /views
  /shared
/data
  /input
    /garments
    /models
    /poses
  /jobs
  /output
  /approved
  /state
```

Piezas principales:

- `InputScannerService`: detecta prendas, modelos y las 4 poses.
- `ProductRepository`: persiste manifests JSON por producto en `data/jobs`.
- `JobRunner`: cola local en background con concurrencia limitada y bloqueo por producto.
- `ProductService`: aprobacion, regeneracion, exportacion y estado global.
- `FalSeedreamImageProvider`: adapter actual del proveedor.
- `PromptService`: plantillas por categoria y pose.
- UI EJS simple: revisar, aprobar, regenerar y navegar producto por producto.

## Flujo del MVP

Al arrancar la app:

1. archiva la corrida anterior en `data/archive/session-...`
2. limpia `data/jobs`, `data/output`, `data/approved` y el estado runtime
3. mueve los archivos actuales de `data/input/...` a una carpeta de sesion dentro de `data/archive`
4. deja `data/input` vacio otra vez
5. crea manifests nuevos desde cero
6. detecta poses pendientes
7. encola generacion en background
8. guarda resultados en `data/output`
9. permite revisar en la UI sin boton principal de "generar todo"

Para cada producto:

- se selecciona exactamente un modelo persistente
- se reutiliza ese mismo modelo para las 4 generaciones del producto
- cada pose genera 1 imagen
- el usuario aprueba 1 imagen por pose
- el producto queda completo cuando hay al menos 1 aprobada por cada pose
- si al aprobar se completa el producto, la UI avanza automaticamente al siguiente
- cada pose tiene un prompt editable antes de regenerar
- al completar las 4 aprobaciones, se exporta a `data/approved/{productId}`

## Inputs

Coloca tus archivos aqui:

- `data/input/garments`
- `data/input/models`
- `data/input/poses`

Reglas del scanner:

- `garments`: puede contener archivos sueltos o carpetas, una carpeta por producto
- `models`: debe contener al menos una imagen
- `poses`: debe contener al menos 4 imagenes; se toman las primeras 4 ordenadas alfabeticamente como `pose1..pose4`
- en cada arranque, los archivos de `input/` se consumen y se mueven a `data/archive/session-.../input`
- esto deja el sistema como un lote nuevo y evita que aparezcan productos viejos en la siguiente corrida

Clasificacion minima:

- si una carpeta de producto tiene `product.json`, puede definir `sku` y `category`
- si no existe metadata, se clasifica por nombre de archivo/carpeta usando keywords
- si no hay match, usa `DEFAULT_CATEGORY`

Ejemplo de `product.json` opcional:

```json
{
  "sku": "MK-001",
  "category": "parte_alta"
}
```

## Instalacion

Requisitos:

- Node.js 20+
- una API key valida de fal.ai

Instalacion:

```bash
npm install
```

## Configuracion de entorno

Copia `.env.example` a `.env` y completa al menos:

```env
PORT=3000
DATA_DIR=./data
MAX_CONCURRENCY=2
REQUEST_TIMEOUT_MS=120000
RETRY_COUNT=2
DEFAULT_CATEGORY=parte_alta
FAL_KEY=tu_api_key
FAL_MODEL=fal-ai/bytedance/seedream/v4.5/edit
OPENAI_API_KEY=tu_api_key_de_openai
```

## Arranque

Desarrollo:

```bash
npm run dev
```

Build + produccion local:

```bash
npm run build
npm start
```

Abrir:

```text
http://localhost:3000
```

## Uso

La app no tiene boton de "generar todo".

Comportamiento esperado:

- al iniciar, escanea y genera automaticamente lo pendiente
- la pantalla principal abre el primer producto util para revision
- cada pose muestra una sola imagen
- puedes aprobar una variante por pose
- puedes regenerar una pose puntual con prompt editable
- la UI refresca automaticamente cuando cambian outputs o estados del producto actual
- hay un boton fijo `Guardar batch` para crear una instantanea manual del estado actual
- puedes navegar con botones `Anterior` y `Siguiente`
- puedes usar teclas `Left/Right` para navegar

Estados:

- `pending`
- `generating`
- `in_review`
- `approved`
- `error`

## Rutas

UI:

- `GET /`
- `GET /review/:id`

API:

- `GET /api/products`
- `GET /api/product/:id`
- `GET /api/status`
- `GET /api/bootstrap`
- `POST /api/product/:id/approve`
- `POST /api/product/:id/regenerate/:poseId`
- `GET /files?path=...`

## Naming de archivos

Intermedios:

- `{productId}-pose1-a.jpg`
- `{productId}-pose2-a.jpg`
- `{productId}-pose3-a.jpg`
- `{productId}-pose4-a.jpg`

Exportados aprobados:

- `{productId}-approved-1.jpg`
- `{productId}-approved-2.jpg`
- `{productId}-approved-3.jpg`
- `{productId}-approved-4.jpg`

Tambien se exporta:

- `MK-{SKU_OR_ID}-1.jpg`
- `MK-{SKU_OR_ID}-2.jpg`
- `MK-{SKU_OR_ID}-3.jpg`
- `MK-{SKU_OR_ID}-4.jpg`

## Persistencia

Persistencia local en JSON:

- `data/jobs/*.json`: manifest por producto
- `data/state/bootstrap-state.json`: estado del bootstrap
- `data/state/active-batch.json`: metadatos del batch activo
- `data/output/{productId}`: imagenes generadas + metadata por variante
- `data/approved/{productId}`: aprobadas exportadas
- `data/archive/saved-batches/...`: snapshots manuales guardados desde la UI

Cada imagen generada guarda metadata:

- prompt final usado
- pose
- variante
- provider
- modelo
- metodo/endpoint
- timestamp
- `responseId` si viene en la respuesta

## Prompting y poses

Las plantillas de prompt viven en:

- `src/server/services/pose-config.ts`
- `src/server/services/prompt-service.ts`

El repo incluye ejemplo de configuracion minima:

- `data/state/prompt-config.example.json`

## Ejemplo de manifest

Hay un ejemplo en:

- `data/state/sample-job.manifest.json`

## Cambio futuro de provider

La UI y la logica de jobs no dependen directamente de fal.ai.

Contrato actual:

```ts
interface ImageGenerationProvider {
  generateVariantsForPose(input): Promise<ProviderGeneratedImage[]>;
}
```

Para cambiar de proveedor:

1. crear una nueva implementacion en `src/server/providers`
2. respetar la interfaz `ImageGenerationProvider`
3. reemplazar la instancia en `src/server/app.ts`

## Verificacion local

Comandos usados para validar el repo:

```bash
npm run check
npm run build
```

## Referencias oficiales revisadas

- [fal.ai Seedream 4.5 edit](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit)
- [fal.ai JS client docs](https://fal.ai/docs/javascript/clients/javascript)

Si fal.ai cambia el identificador del modelo o el schema, ajusta principalmente:

- `FAL_MODEL`
- `src/server/providers/fal-seedream-image-provider.ts`
