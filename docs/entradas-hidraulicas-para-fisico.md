# Datos que faltan para plantear un caso físico

**Ya resuelto:** terreno NASADEM como fuente disponible (sin tratarlo como profundidad); caso global no urbano; NISAR puede describir extensión observada, no profundidad; lluvia temporal con variación ±10 mm/h sobre intensidad media y distribución espacial uniforme en la ROI; duración de simulación la elige el usuario; proveedores de parámetros solo si son disponibles y sencillos; benchmarks de confianza física se posponen al final. La distribución espacial no es una pregunta abierta.

| Dato a acordar o revisar | Unidad y referencia necesaria | Nota |
|---|---|---|
| Estado inicial: profundidad sobre el lecho, **o** nivel de agua | Profundidad en m sobre el lecho local; o elevación del nivel en m referido al mismo datum vertical EGM96 que el terreno | NASADEM HGT aporta elevación, no profundidad. NISAR aporta observación radar/extensión, no h0. No convertir elevación NASADEM en agua. |
| Velocidad inicial o caudal de entrada, cuando aplique | Velocidad en m/s con dirección; descarga por ancho en m²/s; o caudal volumétrico en m³/s a través de una sección nombrada | El físico debe precisar si son necesarios, dónde actúan y su signo/dirección. |
| Frontera idealizada | Lado/segmento del borde computacional y justificación; o condición alternativa y nivel en m con datum vertical declarado; cualquier pendiente como razón adimensional m/m | FREE es una idealización, puede permitir entrada y salida. No equivale automáticamente a outlet. Revisar la [guía FREE](fronteras-idealizadas-dg2.md). |
| Hidrograma Q(t), si se necesita | Caudal volumétrico en m³/s versus tiempo en segundos, asociado a una sección de entrada/salida nombrada | No hay sección ni serie elegida. No inventar la forma de Q(t). |
| Rugosidad de Manning n | s/m^(1/3), con fuente/cita y clase/superficie a la que aplica | No usar un valor genérico sin proveedor o decisión documentada. |

**Infiltración:** no está implementada en la ruta CPU DG2 8.0 inspeccionada. No hay `infil0` implícito ni afirmación científica de infiltración cero; no restar infiltración de lluvia como sustituto silencioso. Si afecta el caso, queda pendiente una opción compatible y físicamente justificada.

La guía oficial NASADEM V1.3 (enero 2025), §3 y tabla 1, define NASADEM_HGT como elevaciones en metros respecto del geoide EGM96. Referencia: [NASADEM User Guide V1.3 (USGS LP DAAC)](https://lpdaac.usgs.gov/documents/2237/NASADEM_User_Guide_V13.pdf); comprobación del proyecto: [verificación DG2, «Qué significa el DEM de NASADEM»](verificacion-dg2.md#qué-significa-el-dem-de-nasadem). Por ello, la afirmación del usuario «NASADEM indica profundidad» se conserva como solicitud, pero no es un dato implementable como hecho.

No se solicita decidir ahora benchmarks ni tolerancias de confiabilidad; se diseñarán al final. Esta lista no habilita ejecución del solver.
