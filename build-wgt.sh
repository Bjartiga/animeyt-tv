#!/usr/bin/env bash
# Empaqueta y firma AnimeYTTV.wgt como app nativa para la tele (se instala con TizenBrew Installer).
#
# Firma: certificado de autor propio + distribuidor público "clásico" del SDK de Tizen
# (el mismo esquema que usa TizenBrew para Tizen < 7). Requisitos (una sola vez):
#   - Tizen CLI en ~/tizen-studio
#   - Perfil de seguridad "AnimeYT" (tizen security-profiles add ...)
#   - Contraseña del autor en ~/tizen-studio-data/animeyt-author.pw
# Usar SIEMPRE el mismo certificado de autor: si cambia, la tele no deja actualizar sin desinstalar.
#
# Uso:
#   ./build-wgt.sh             -> dist/AnimeYTTV-<versión>.wgt
#   DEV_LOGS=1 ./build-wgt.sh  -> además reenvía console/errores al dev-server del Mac (puerto 8088)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIZEN="${TIZEN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
PROFILE="AnimeYT"
DEV_LOG_URL="${DEV_LOG_URL:-http://192.168.100.7:8088/__log}"

cd "$PROJECT_DIR"
VERSION="$(sed -n 's/.*<widget[^>]* version="\([^"]*\)".*/\1/p' config.xml)"
BUILD_DIR="$PROJECT_DIR/build/wgt"
OUT="$PROJECT_DIR/dist/AnimeYTTV-$VERSION.wgt"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$PROJECT_DIR/dist"
cp -R config.xml index.html icon.png css js img "$BUILD_DIR/"
find "$BUILD_DIR" -name '.DS_Store' -delete

if [ "${DEV_LOGS:-0}" = "1" ]; then
    python3 - "$BUILD_DIR/index.html" "$DEV_LOG_URL" <<'EOF'
import sys
path, url = sys.argv[1], sys.argv[2]
client = """<script>
(function() {
    window.__TV_DEV_LOGS__ = true;
    var URL_LOG = '%s';
    function send(level, args) {
        try {
            var parts = [];
            for (var i = 0; i < args.length; i++) {
                var a = args[i];
                if (a && a.stack) parts.push(a.stack);
                else if (typeof a === 'object') { try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); } }
                else parts.push(String(a));
            }
            var xhr = new XMLHttpRequest();
            xhr.open('POST', URL_LOG, true);
            xhr.send(JSON.stringify({ level: level, msg: '[wgt] ' + parts.join(' ') }));
        } catch (e) {}
    }
    ['log', 'warn', 'error'].forEach(function(level) {
        var original = console[level];
        console[level] = function() { send(level, arguments); return original.apply(console, arguments); };
    });
    window.addEventListener('error', function(e) {
        send('error', ['[window.onerror]', e.message, (e.filename || '') + ':' + e.lineno + ':' + e.colno]);
    });
    window.addEventListener('unhandledrejection', function(e) { send('error', ['[unhandledrejection]', e.reason]); });
    send('log', ['cargado', location.href, navigator.userAgent, window.innerWidth + 'x' + window.innerHeight]);
})();
</script>
""" % url
html = open(path).read()
html = html.replace('<script src="js/keys.js">', client + '    <script src="js/keys.js">', 1)
open(path, 'w').write(html)
EOF
    echo "🛠  DEV_LOGS activado -> $DEV_LOG_URL"
fi

rm -f "$BUILD_DIR"/*.wgt
"$TIZEN" package -t wgt -s "$PROFILE" -- "$BUILD_DIR" >/dev/null
mv "$BUILD_DIR"/*.wgt "$OUT"

echo "✅ $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | grep -E 'signature|config.xml'
