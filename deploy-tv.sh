#!/usr/bin/env bash
set -e

TV_IP="$1"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="animeyt-tizen-builder"

echo "=========================================================="
echo "📺 AnimeYT Samsung Smart TV Deployer (vía Docker)"
echo "=========================================================="

if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker no está instalado o no se encuentra en el PATH."
    echo "Descarga Docker Desktop para Mac en https://www.docker.com/"
    exit 1
fi

cd "$PROJECT_DIR"

# 1. Construir la imagen Docker si no existe
if ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
    echo "🏗️  Construyendo imagen Docker con Tizen Studio CLI ($IMAGE_NAME)..."
    echo "   (Esto solo se hace una vez y toma unos minutos)"
    docker build --platform linux/amd64 -t "$IMAGE_NAME" .
else
    echo "✓ Imagen Docker $IMAGE_NAME ya disponible."
fi

# 2. Ejecutar contenedor para empaquetar e instalar
echo "🚀 Ejecutando contenedor de empaquetado..."
docker run --rm \
    --platform linux/amd64 \
    -v "$PROJECT_DIR":/workspace \
    "$IMAGE_NAME" "$TV_IP"
