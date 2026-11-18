# Interfaz ROI conectada a DG2
Objetivo: recuperar documentación histórica y conectar el flujo visible con la ejecución DG2 existente. Rama: `feature/flood-ui-dg2`; base: `9f47683`.
Entrega: `auto-chain`, `feature-branch-chain` (selección humana); commits locales por unidad, sin publicar. Pruebas: entorno conda `nisar`, Node, build/lint web.

## Specs
S1. «recupera selectivamente los archivos» — archivos acordados: `docs/simulacion-inundacion-dg2.tex`, `docs/simulacion-inundacion-dg2.pdf`, `docs/diagramas/flujo-dg2-completo.drawio`, `docs/diagramas/flujo-dg2-completo.png`, desde `simulacion-inundancion` (`7802fce`). Comprobar identidad de blobs; no fusionar rama ni recuperar registros ODD históricos.
S2. «haz lo que hace falta para conectar la interfaz» — referencia a la propuesta aceptada: utilizar API ROI DG2 autenticada, entradas explícitas, estados/errores, resultados georreferenciados y advertencias, sin fallback al cálculo simplificado. Comprobar contratos y flujo con fixtures aislados, build y pruebas existentes afectadas.
S3. «Nosotros nos concentraremos en la simulación de inundacion» — alcance: inundación; no radiación, sismos ni rediseño general.

## Tasks
T1 | S1,S3 | ruta: parent inline | estado: in_progress | commit: pendiente | Recuperar cuatro entregables históricos y verificar blobs.
T2 | S2,S3 | ruta: gentle-ai-worker backend | estado: pending | commit: pendiente | Preview PNG autenticada EPSG:3857 de COG existente, pruebas y documentación del contrato. Risk: item 2 (autorización/artefactos); item 3 (helper compartido descarga).
T3 | S2,S3 | ruta: gentle-ai-worker frontend | estado: pending | commit: pendiente | Cliente ROI, formulario explícito, seguimiento, preview y métricas reales; pruebas y LaTeX de la feature. Risk: item 2 (sesión/CSRF); item 3 (estado de inundación compartido).
T4 | S1-S3 | ruta: parent + gentle-ai-verify | estado: pending | commit: pendiente | Seam checks, verificación independiente de riesgos, documentación de evidencia y cierre.

## Log
L1. Solicitud original: «Perfecto, recupera selectivamente los archivos y haz lo que hace falta para conectar la interfaz».
L2. Contexto autorizado: «Okay, crea una nueva rema apartir de esta, me parece bien conectar la interfaz con DG2, explicame el plan que se piensa realizar.»; luego «Okay, antes de ello, analiza lo que esta implementado en la rama de "simulacion-inundancion", revisa que puedes rescatar de ahí.»
L3. Selección humana de entrega: «Cadena sobre rama de feature (recomendado)». No autoriza publicar PR, push ni merge. Previsión: >400 líneas autorales incluyendo 366 líneas recuperadas; unidades revisables de documentación, preview y cliente/panel (sin comprimir para un límite artificial).
L4. Exploración: núcleo DG2 idéntico entre ramas; API ROI existente exige sesión y CSRF. No hay login de aplicación; aprovechar sesión Django existente y mostrar error accionable, sin crear sistema nuevo. COG UTM no es imagen MapLibre; se añadirá preview PNG reproyectada a EPSG:3857, conservando COG/hash/propietario. Dominio y parámetros deberán ser elegidos explícitamente; no inferir cuenca ni parámetros físicos recomendados. No se inventan velocidades, riesgo, infiltración ni cronología real; lluvia sintética y exactitud no validada permanecen visibles.
L5. Ruta: T2 y T3 son unidades independientes con contrato preview fijo y superficies disjuntas, cada una varios minutos y varios archivos; se lanzarán juntas. Contrato: GET `/api/flood-roi-runs/<uuid>/artifacts/<name>/preview/`, PNG RGBA, `X-Preview-CRS: EPSG:3857`, `X-Preview-Bounds: west,south,east,north` en EPSG:4326 del raster reproyectado, `X-Preview-Units: m`, escala fija documentada y hash/owner iguales a COG. Frontend obtiene blob autenticado y bounds de headers; no pasar TIFF a MapLibre. No alterar contratos existentes. Alcance temporal de UI: máximo y cuadros por índice/tiempo solicitado, nunca tiempo físico observado.
L6. Entorno: base no tiene pytest/Django/rasterio/Pillow; existe conda `nisar` y `web/node_modules`. No instalar dependencias. Disponibilidad de ejecución real NASADEM/DG2 pendiente de comprobar sin descargar datos ni lanzar trabajos reales sin parámetros físicos acordados. RDD off; no assessment nativo. Verificador independiente obligatorio por items 2/3.
