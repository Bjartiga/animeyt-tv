#!/usr/bin/env bash

TV_IP="${1:-192.168.100.95}"
MAC_IP="192.168.100.7"

echo "=========================================================="
echo "🔍 Diagnóstico de Conexión: Samsung Smart TV ($TV_IP)"
echo "=========================================================="

# 1. Ping test
echo -n "1. Verificando conectividad IP ($TV_IP)... "
if ping -c 1 -W 2 "$TV_IP" > /dev/null 2>&1; then
    echo "✅ TV ONLINE (Responde al ping)"
else
    echo "❌ TV NO RESPONDE AL PING. Revisa que esté encendida y en la misma red Wi-Fi/LAN."
    exit 1
fi

# 2. SDB Port 26101 test
echo -n "2. Verificando puerto de desarrollador (26101)... "
if nc -zv -w 2 "$TV_IP" 26101 > /dev/null 2>&1; then
    echo "✅ PUERTO 26101 ABIERTO (Modo Desarrollador ACTIVO)"
    echo ""
    echo "🎉 ¡Tu televisor está 100% listo para instalar apps!"
    echo "👉 Abre TizenBrew Installer en tu navegador:"
    echo "   http://localhost:8091/ui/dist/index.html"
else
    echo "⚠️  PUERTO 26101 CERRADO (Connection refused)"
    echo ""
    echo "👉 Falta activar el Modo Desarrollador en la tele:"
    echo "   1. En la tele, abre la sección 'Apps'."
    echo "   2. Con el control remoto, presiona la secuencia: 1 2 3 4 5"
    echo "   3. Aparecerá una ventana emergente: pon Developer Mode en 'ON'."
    echo "   4. En 'Host PC IP', ingresa la IP de tu Mac: $MAC_IP"
    echo "   5. Haz clic en OK."
    echo "   6. REINICIA LA TELE: Mantén presionado el botón Power del control"
    echo "      durante 4 segundos hasta que veas el logo de Samsung reiniciando."
    echo ""
    echo "Luego vuelve a ejecutar este script: ./check-tv.sh"
fi
