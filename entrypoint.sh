#!/usr/bin/env bash
set -e

TV_IP="$1"

echo "=================================================="
echo "📦 Tizen WGT Packager & Installer"
echo "=================================================="

cd /workspace

# 1. Crear perfil de seguridad y certificado autofirmado si no existe
mkdir -p /root/tizen-studio-data/keystore/author
if ! tizen security-profiles list 2>/dev/null | grep -q "AnimeYTSecProfile"; then
    echo "🔐 Generando perfil de seguridad y certificado de autor..."
    tizen certificate -a AnimeYTAuthor -p 123456 -c "AnimeYT" -f AnimeYTAuthor 2>/dev/null || true
    CERT_PATH=$(find /root -name "AnimeYTAuthor.p12" 2>/dev/null | head -n 1)
    if [ -n "$CERT_PATH" ]; then
        tizen security-profiles add -n AnimeYTSecProfile -a "$CERT_PATH" -p 123456 2>/dev/null || true
    fi
fi

# 2. Empaquetar .wgt
echo "📦 Empaquetando aplicación en AnimeYTTV.wgt..."
rm -f AnimeYTTV.wgt 2>/dev/null || true

if tizen security-profiles list 2>/dev/null | grep -q "AnimeYTSecProfile"; then
    tizen package -t wgt -s AnimeYTSecProfile -o . -- .
else
    tizen package -t wgt -o . -- .
fi

WGT_FILE=$(ls -t *.wgt 2>/dev/null | head -n 1)

if [ -z "$WGT_FILE" ]; then
    echo "❌ Error: No se pudo generar el archivo .wgt"
    exit 1
fi

echo "✅ Paquete generado exitosamente: $WGT_FILE ($(du -h "$WGT_FILE" | cut -f1))"

# 3. Conectar e instalar en la TV si se proporcionó una IP
if [ -n "$TV_IP" ]; then
    echo "📺 Conectando a Samsung Smart TV en $TV_IP:26101..."
    sdb connect "$TV_IP" || true
    sleep 2
    sdb devices

    echo "🚀 Instalando $WGT_FILE en el televisor..."
    sdb install "$WGT_FILE"
    echo "🎉 ¡Instalación finalizada! Abre el launcher de tu TV para iniciar AnimeYT TV."
else
    echo "ℹ️  Archivo listo en tu máquina. Para instalar en el televisor ejecuta:"
    echo "   ./deploy-tv.sh <IP_DE_TU_SAMSUNG_TV>"
fi
