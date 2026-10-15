#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="$PROJECT_DIR/AnimeYTTV.wgt"

echo "=========================================================="
echo "📦 Empaquetador Rápido de AnimeYTTV.wgt"
echo "=========================================================="

cd "$PROJECT_DIR"
rm -f "$OUTPUT_FILE"

# Un archivo .wgt es un archivo ZIP estándar con config.xml en la raíz
zip -r "$OUTPUT_FILE" \
    config.xml \
    package.json \
    index.html \
    icon.png \
    .tproject \
    css/ \
    js/ \
    img/ \
    -x "*.DS_Store" -x "*/.DS_Store"

echo "----------------------------------------------------------"
echo "✅ Paquete generado: $OUTPUT_FILE"
echo "📊 Tamaño: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo "----------------------------------------------------------"
