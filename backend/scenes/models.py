"""Escenas NISAR, la ROI y la inspección de la Etapa 1 (con los datos de sus gráficas).

Django no ejecuta el pipeline: lee los archivos que deja ``python -m pipeline.etapa1`` en
``data/explore/<granuleId>/`` (``metadatos.json`` y ``graficas.json``) con el comando
``python manage.py load_explore``. Cada fila guarda de qué archivo y de qué versión del código
salió (AGENTS.md §2.3).
"""
from django.contrib.gis.db import models


class ROI(models.Model):
    name = models.CharField(max_length=100)
    geom = models.PolygonField(srid=4326)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "ROI"
        verbose_name_plural = "ROIs"

    def __str__(self):
        return self.name


class Scene(models.Model):
    """Un producto NISAR. Los campos salen del .h5 (identification) y del catálogo (madurez)."""

    name = models.CharField(max_length=200, unique=True)          # granuleId
    product = models.CharField(max_length=10)                     # GCOV, GSLC
    track = models.PositiveIntegerField()
    frame = models.PositiveIntegerField()
    direction = models.CharField(max_length=12)                   # ASCENDING / DESCENDING
    polarization = models.CharField(max_length=20)                # "HH+HV" (leídas del .h5)
    frequency = models.CharField(max_length=2)                    # A
    band = models.CharField(max_length=2, blank=True)             # radarBand del .h5 ("L")
    epsg = models.PositiveIntegerField(null=True, blank=True)     # CRS de la malla del producto
    crid = models.CharField(max_length=10)
    # Del catálogo; null si no se conoce (inspección local). No se deduce del CRID (AGENTS.md §5).
    maturity = models.CharField(max_length=20, null=True, blank=True)
    start_time = models.DateTimeField()                           # zeroDopplerStartTime
    footprint = models.PolygonField(srid=4326, null=True, blank=True)   # boundingPolygon del .h5 (2D)

    class Meta:
        ordering = ["start_time"]

    def __str__(self):
        return self.name


class SceneInspection(models.Model):
    """Una corrida de la Etapa 1 sobre una escena y una ROI (``metadatos.json``)."""

    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name="inspections")
    roi = models.ForeignKey(ROI, on_delete=models.PROTECT, related_name="inspections")
    code_version = models.CharField(max_length=64)
    created_utc = models.DateTimeField()                          # cuándo corrió etapa1
    pct_valid_in_roi = models.FloatField()
    roi_stats = models.JSONField()                                # estadisticas_roi tal cual
    provenance = models.JSONField()                               # procedencia (modo, URL, catálogo…)
    warnings = models.JSONField(default=list)
    source_dir = models.CharField(max_length=512)                 # data/explore/<granuleId>
    loaded_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Volver a cargar la misma versión del código reemplaza; otra versión agrega una fila nueva.
        constraints = [models.UniqueConstraint(fields=["scene", "code_version"], name="uniq_inspection_version")]
        ordering = ["-created_utc"]

    def __str__(self):
        return f"{self.scene.name} @ {self.code_version}"


class SceneChart(models.Model):
    """Una gráfica de ``graficas.json`` (histograma, máscara, incidencia). ``data`` es la entrada tal cual."""

    inspection = models.ForeignKey(SceneInspection, on_delete=models.CASCADE, related_name="charts")
    chart_id = models.CharField(max_length=64)                    # "histograma_gamma0_dB", …
    format_version = models.CharField(max_length=32)              # "graficas-etapa1-1"
    data = models.JSONField()
    source_file = models.CharField(max_length=512)                # ruta de graficas.json

    class Meta:
        constraints = [models.UniqueConstraint(fields=["inspection", "chart_id"], name="uniq_chart_per_inspection")]
        ordering = ["chart_id"]

    def __str__(self):
        return f"{self.chart_id} ({self.inspection})"
