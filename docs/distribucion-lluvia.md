# Perfil sintético de lluvia

El generador ofrece una capacidad opcional y reproducible para repartir una lluvia ya especificada en el tiempo. Está integrado explícitamente en `POST /api/flood-scenarios/prepare/` mediante el campo opcional `rainfall_profile`; sin ese campo, la API conserva su flujo anterior y no genera perfil. La ruta habitual sigue siendo offline y no ejecuta adquisición ni simulación. La ley `uniform_balanced` es una elección computacional simple, no una distribución calibrada con observaciones ni una descripción validada de tormentas.

## Uso explícito

```python
from pipeline.hydrology.rainfall import generate_rainfall_profile

profile = generate_rainfall_profile(
    {
        "rainfall": {"amount": 12, "unit": "mm", "duration": 2, "duration_unit": "h"},
        "roi": {"type": "Polygon", "coordinates": [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]]},
    },
    interval_count=8,
    seed=27,
    distribution="uniform_balanced",
)
```

Se requiere escoger explícitamente `interval_count`, `seed` y `distribution`; no hay paso temporal predeterminado. El payload usa exactamente el contrato de `normalize_request` (cantidad o intensidad con duración y ROI GeoJSON). Los errores de entrada conservan la validación compartida; parámetros del generador inválidos producen `ValueError`. El conteo debe ser par entre 2 y 10 000 inclusive.

## Significado de la ley

La intensidad se expresa en m/s: altura de una lámina de agua por unidad de tiempo sobre un área horizontal. La tolerancia solicitada de ±10 mm/h se convierte a `10 / 1000 / 3600` m/s y se aplica a cada intervalo respecto de la intensidad media. Si la media es menor que ese límite, el límite efectivo se reduce a la media: así se evita lluvia negativa sin truncar muestras y alterar silenciosamente el total. Si la media es cero, todos los intervalos son cero.

Se toman `n/2` desviaciones uniformes en `[-a, +a]`, se añade a cada una su opuesta y se mezclan las contribuciones entre los intervalos. La densidad de cada desviación antes del emparejamiento es `f(x)=1/(2a)` en ese soporte, cero fuera (para `a > 0`). El emparejamiento induce dependencia entre intervalos: no son muestras independientes ni una ley física de tormenta. La suma de las desviaciones es cero y preserva la media y la cantidad prescritas, salvo redondeo de coma flotante. Los segmentos tienen igual duración nominal, cubren `[0, duration]` sin huecos ni solapes y el último termina exactamente en la duración solicitada. La división y conservación numéricas usan coma flotante: límites intermedios solo son aproximados, se rechazan intervalos que colapsen numéricamente y la integral se conserva dentro del redondeo de máquina.

La aleatoriedad usa un generador local con semilla; repetir entradas y semilla reproduce el perfil sin cambiar el estado global de `random`. La respuesta incluye `rainfall` normalizada (incluido el modo y entrada original), ROI, segmentos `{start_s, end_s, intensity_m_s}`, metadatos de distribución/límites/semilla, `synthetic: true` y `hydraulic_ready: false`.

## Uso por HTTP

El cliente debe enviar expresamente `rainfall_profile: {"interval_count": ..., "seed": ..., "distribution": "uniform_balanced"}` junto con la lluvia y ROI. Los tres parámetros son obligatorios; no existe intervalo, semilla o distribución predeterminados. El endpoint devuelve la serie temporal para que la interfaz grafique intensidad frente al tiempo. Véase el contrato de solicitud, respuesta y errores en [Preparación de entradas de inundación](api-simulacion-inundacion.md#perfil-temporal-opcional).

La serie es lluvia sintética temporal, no una predicción ni un mapa de extensión/profundidad de inundación. La lluvia no recibe distribución espacial: ninguna uniformidad espacial queda seleccionada o asumida.

## Estado inicial elegido y datos pendientes

La fuente escogida para obtener observaciones de extensión de agua es NISAR. Esto no proporciona por sí solo profundidad ni resuelve la clasificación de agua: no hay clasificador inicial validado en este flujo, y agua desconocida/no observada no se convierte automáticamente en condición seca. La clasificación y la profundidad inicial siguen pendientes por separado; no se inventan valores para habilitar el solver.

## Límites

Este perfil solo representa una variación temporal uniforme y balanceada. No aporta distribución espacial, historial o pronóstico, calibración, infiltración, condiciones de frontera, DEM ni solver. No determina si el escenario es físicamente apropiado y no implica profundidad, velocidad, inundación ni resultado científico. La integración HTTP opcional ya está disponible; la integración en UI y la selección/uso como forzamiento de un solver siguen pendientes de decisiones y validaciones independientes.
