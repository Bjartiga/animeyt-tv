/**
 * dev-server.js - Servidor de desarrollo local y Proxy CORS para AnimeYT TV
 * 100% Node.js nativo (sin dependencias de npm)
 * - Sirve archivos estáticos (index.html, css, js, icon, etc.)
 * - Endpoint /proxy?url=... para bypasear CORS en pruebas de navegador en Mac / TV
 * - Modo desarrollo en la tele (módulo TizenBrew "dev-loader"):
 *   - Recarga automática cuando cambia algún archivo (/__version)
 *   - Errores y console.* del TV se imprimen en esta terminal (/__log)
 * - Escucha en 0.0.0.0:8080 (o PORT)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const urlModule = require('url');
const zlib = require('zlib');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
const ROOT_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wgt': 'application/widget'
};

// Script inyectado en index.html: marca modo dev, reenvía errores al Mac y recarga al cambiar archivos
const DEV_CLIENT = `<script>
(function() {
    window.__TV_DEV__ = true;
    window.__TV_DEV_LOGS__ = true;
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
            xhr.open('POST', '/__log', true);
            xhr.send(JSON.stringify({ level: level, msg: parts.join(' ') }));
        } catch (e) {}
    }
    ['log', 'warn', 'error'].forEach(function(level) {
        var original = console[level];
        console[level] = function() {
            send(level, arguments);
            return original.apply(console, arguments);
        };
    });
    window.addEventListener('error', function(e) {
        send('error', ['[window.onerror]', e.message, (e.filename || '') + ':' + e.lineno + ':' + e.colno]);
    });
    window.addEventListener('unhandledrejection', function(e) {
        send('error', ['[unhandledrejection]', e.reason]);
    });
    send('log', ['[dev] cargado', navigator.userAgent, window.innerWidth + 'x' + window.innerHeight, 'dpr=' + window.devicePixelRatio]);

    var version = null;
    setInterval(function() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/__version', true);
        xhr.onload = function() {
            if (version !== null && xhr.responseText !== version) location.reload();
            version = xhr.responseText;
        };
        xhr.send();
    }, 1500);
})();
</script>
`;

// Última modificación de index.html, css/ y js/
function latestMtime() {
    let latest = 0;
    const visit = (p) => {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            fs.readdirSync(p).forEach((f) => visit(path.join(p, f)));
        } else if (st.mtimeMs > latest) {
            latest = st.mtimeMs;
        }
    };
    ['index.html', 'css', 'js'].forEach((p) => visit(path.join(ROOT_DIR, p)));
    return String(latest);
}

function handleDevLog(req, res) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        try {
            const entry = JSON.parse(body);
            const tag = entry.level === 'error' ? '❌ TV' : entry.level === 'warn' ? '⚠️  TV' : '📺 TV';
            console.log(`${tag} ${entry.msg}`);
        } catch (e) {
            console.log('📺 TV (log inválido)', body);
        }
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
    });
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

/**
 * Realiza la petición proxy siguiendo redirecciones automáticamente
 */
function handleProxy(targetUrl, clientReq, clientRes, redirectCount = 0) {
    if (redirectCount > 5) {
        clientRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        clientRes.end('Demasiadas redirecciones en el proxy');
        return;
    }

    let parsedTarget;
    try {
        parsedTarget = new URL(targetUrl);
    } catch (e) {
        clientRes.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        clientRes.end('URL de destino inválida: ' + targetUrl);
        return;
    }

    const isHttps = parsedTarget.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36',
        'Accept': clientReq.headers['accept'] || '*/*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Host': parsedTarget.host
    };

    if (clientReq.headers['content-type']) requestHeaders['Content-Type'] = clientReq.headers['content-type'];

    // Forward cookies if provided
    if (clientReq.headers['cookie']) {
        requestHeaders['Cookie'] = clientReq.headers['cookie'];
    }

    // Set Referer matching target origin
    requestHeaders['Referer'] = `${parsedTarget.protocol}//${parsedTarget.host}/`;
    requestHeaders['Origin'] = `${parsedTarget.protocol}//${parsedTarget.host}`;

    const options = {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (isHttps ? 443 : 80),
        path: parsedTarget.pathname + parsedTarget.search,
        method: clientReq.method || 'GET',
        headers: requestHeaders,
        timeout: 15000
    };

    const proxyReq = client.request(options, (proxyRes) => {
        // Manejo de Redirecciones (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
            console.log(`[Proxy] Redirigiendo (${proxyRes.statusCode}) -> ${redirectUrl}`);
            proxyRes.resume(); // Descartar body
            handleProxy(redirectUrl, clientReq, clientRes, redirectCount + 1);
            return;
        }

        setCorsHeaders(clientRes);

        // Copiar Content-Type si está disponible
        if (proxyRes.headers['content-type']) {
            clientRes.setHeader('Content-Type', proxyRes.headers['content-type']);
        }

        // Manejo de descompresión gzip/deflate
        const encoding = proxyRes.headers['content-encoding'];
        clientRes.writeHead(proxyRes.statusCode);

        if (encoding === 'gzip') {
            proxyRes.pipe(zlib.createGunzip()).pipe(clientRes);
        } else if (encoding === 'deflate') {
            proxyRes.pipe(zlib.createInflate()).pipe(clientRes);
        } else {
            proxyRes.pipe(clientRes);
        }
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!clientRes.headersSent) {
            setCorsHeaders(clientRes);
            clientRes.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
            clientRes.end('Timeout al conectar con el servidor de destino');
        }
    });

    proxyReq.on('error', (err) => {
        console.error('[Proxy Error]:', err.message);
        if (!clientRes.headersSent) {
            setCorsHeaders(clientRes);
            clientRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            clientRes.end('Error del proxy: ' + err.message);
        }
    });

    if (clientReq.method === 'POST') {
        clientReq.pipe(proxyReq);
    } else {
        proxyReq.end();
    }
}

/**
 * Sirve archivos estáticos locales
 */
function handleStatic(pathname, res) {
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
    }

    const filePath = path.join(ROOT_DIR, safePath);

    if (safePath === '/index.html') {
        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
                res.writeHead(500);
                res.end(String(err));
                return;
            }
            const withDev = html.replace('<script src="js/keys.js">', DEV_CLIENT + '    <script src="js/keys.js">');
            setCorsHeaders(res);
            res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store' });
            res.end(withDev);
        });
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            setCorsHeaders(res);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 No encontrado');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        setCorsHeaders(res);
        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Cache-Control': 'no-store'
        });

        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);

    // Manejo de preflight CORS OPTIONS
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // Modo dev en la tele
    if (parsedUrl.pathname === '/__version') {
        setCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end(latestMtime());
        return;
    }
    if (parsedUrl.pathname === '/__log' && req.method === 'POST') {
        handleDevLog(req, res);
        return;
    }

    // Endpoint Proxy CORS
    if (parsedUrl.pathname === '/proxy') {
        const target = parsedUrl.searchParams.get('url');
        if (!target) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Falta el parámetro ?url=');
            return;
        }
        console.log(`[Proxy Request] -> ${target}`);
        handleProxy(target, req, res);
        return;
    }

    // Archivos Estáticos
    handleStatic(parsedUrl.pathname, res);
});

server.listen(PORT, HOST, () => {
    console.log('========================================================');
    console.log(`🚀 AnimeYT TV Dev Server listo en http://${HOST}:${PORT}`);
    console.log(`📡 Proxy CORS disponible en http://${HOST}:${PORT}/proxy?url=<URL>`);
    console.log(`📺 En tu Samsung TV abre: http://<IP_DE_TU_MAC>:${PORT}`);
    console.log('========================================================');
});
