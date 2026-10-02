@AGENTS.md

# Cómo trabajar en este proyecto

Yo (Claude) construí este proyecto y lo conozco mejor que el usuario. Antes de preguntarle cualquier dato técnico sobre él (dónde corre el servidor, cómo se despliega, qué panel se usa, cómo están configurados los webhooks, rutas, base de datos, variables de entorno, tokens y credenciales de API, o cualquier otra cosa), lo busco yo mismo en el código, en la configuración y en el historial del proyecto.

Si lo encuentro, lo uso y sigo trabajando sin preguntar. Además, lo anoto en este mismo archivo (sección "Infraestructura conocida" más abajo) para no volver a buscarlo la próxima vez. Excepción: los tokens, contraseñas y credenciales se leen de donde estén (por ejemplo `.env`) y se usan, pero nunca se copian a este archivo ni se escriben en el repositorio.

Solo si un dato de verdad no existe en ninguna parte del proyecto, se le pregunta al usuario, y únicamente por ese dato. No se le pide confirmar cosas que se pueden verificar solo.

El usuario no tiene acceso al panel de despliegue (EasyPanel), así que cualquier tarea que dependa de eso la resuelvo yo.

Antes de modificar algo que ya funciona, hago un commit del estado actual, para poder volver atrás siempre.

Cuando termino un cambio, lo pruebo yo mismo levantando el proyecto y verificando que funciona. Recién entonces aviso que está listo y digo qué se probó. Nunca se deja al usuario descubriendo que algo se rompió.

**Flujo de trabajo por defecto:** aplico todos los cambios en local y levanto el servidor de desarrollo sin preguntar nada. Al terminar, mando el link de localhost listo para abrir de una, sin credenciales ni pasos extra.

No se pregunta si se quiere hacer commit ni push. El commit de respaldo antes de tocar código se hace solo. El push a producción lo pide el usuario explícitamente, después de revisar el cambio en local.

## Infraestructura conocida

- **Hosting:** self-hosted en EasyPanel vía Docker (`Dockerfile` + `docker-compose.yml` en la raíz), no Vercel.
- **URL de producción:** `https://personal-wacrm.b84vtl.easypanel.host`
- **Despliegue:** un webhook dispara el rebuild al pushear a `origin/main`. Reconstruye la imagen Docker completa, así que tarda varios minutos (no es instantáneo como Vercel). Si un cambio no aparece justo después del push, antes de asumir que algo falló hay que considerar este tiempo de rebuild y, si hace falta, revisar el estado del build en el dashboard de EasyPanel.
- **Base de datos:** Supabase (carpeta `supabase/` con `migrations/`, `config.toml`, `ci/`).
- **Variables de entorno:** `.env` (real, con secretos, no se sube al repo) y `.env.local.example` (plantilla de referencia) en la raíz.
- **Precios y catálogo (cobertores, LED, etc.) del bot de IA:** NO viven en el código — están en la base de conocimiento de IA en Supabase, tablas `ai_knowledge_documents` (contenido fuente, uno por tema/producto) y `ai_knowledge_chunks` (unidades de recuperación que el bot realmente lee, generadas a partir del documento). Para cambiar un precio hay que actualizar `ai_knowledge_documents.content` y volver a generar sus chunks (borrar los chunks del documento e insertarlos de nuevo con `chunkText`, ver `src/lib/ai/chunk.ts` y `src/lib/ai/knowledge.ts::ingestDocument`) — si solo se edita `content` sin regenerar los chunks, el bot sigue contestando con el precio viejo porque el RAG lee de `ai_knowledge_chunks`, no del documento. La cuenta de producción (GMVA) tiene `account_id = 10c19410-3975-48d9-9bc5-0eb16fca08d7` y no tiene `embeddings_api_key` configurada, así que la búsqueda es solo léxica (FTS) — no hace falta generar embeddings al reindexar.

## Decisiones tomadas

- 2026-09-28: Se define el flujo de trabajo de este archivo (investigar antes de preguntar, commit de respaldo antes de tocar código, probar en local antes de avisar, no pedir confirmación para commit/push local, push a producción solo a pedido explícito).
- 2026-09-30: Se corrige el precio del cobertor de "moto lineal" (todas las tallas) de S/65.90 a S/75.90 directo en la base de conocimiento de IA de producción (Supabase), y se resincronizan sus chunks — estaban desfasados del documento (el documento ya decía S/65.90 pero el chunk que el bot lee todavía decía S/65.00), señal de que alguna edición anterior tocó `content` sin reindexar.
- 2026-10-01: Se encuentran y corrigen dos bugs reales en el paste de imágenes del composer (`src/components/inbox/message-composer.tsx`), reproducidos con eventos de clipboard sintéticos en el navegador (no con clipboard real de Windows) para confirmar la causa antes de tocar código: (1) pegar una segunda imagen mientras la primera todavía se estaba subiendo no hacía nada porque `handlePaste`/`handleCaptionPaste` abortaban si `busy` era true, aunque `stageFiles` ya encola subidas en paralelo de forma segura — esto es lo que hacía parecer que solo se podía pegar una imagen a la vez. (2) el texto escrito mientras una imagen se subía se perdía al aterrizar el adjunto, porque el traspaso a caption leía el `text` capturado por closure en el momento del paste en vez del valor más reciente — se arregla leyendo de un ref siempre actualizado.
- 2026-10-02: Se diagnostica "cuando envío un template no puedo leerlo": las 3 campañas de Broadcast ya enviadas en producción (hasta 1000 destinatarios) llegaban por WhatsApp pero nunca quedaban en `messages` — ni `deliverBroadcast` (usado por la API pública `/api/v1/broadcasts` y por el resume) ni el endpoint del dashboard `/api/whatsapp/broadcast` (el que realmente usa el wizard de Broadcasts vía `use-broadcast-sending.ts`) escribían la conversación; solo actualizaban `broadcast_recipients`. Esto es un bug distinto y más nuevo que el ya corregido en #483 (que cubría los envíos 1 a 1 desde el composer/API/automations, los cuales sí quedaban bien). Fix: ambos paths ahora resuelven/crean la conversación del contacto (`findOrCreateConversation`) e insertan el mensaje (`content_type: 'template'`, texto ya sustituido vía `templateContentText`) igual que los envíos individuales. Verificado en producción enviando una plantilla real de prueba y confirmando visualmente en el Inbox que la burbuja aparece con el texto correcto.
