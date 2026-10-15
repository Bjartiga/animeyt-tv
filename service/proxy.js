/**
 * proxy.js - Servicio TizenBrew (corre en el Node.js del TV)
 * Proxy CORS en http://127.0.0.1:8085/proxy?url=<URL>
 * La app se sirve desde http://127.0.0.1:8081 (TizenBrew), así que sin este
 * proxy el navegador bloquea las peticiones a animeyt.cc y mytsumi.com.
 *
 * ES5 puro: TizenBrew ejecuta los servicios en Node.js 4.x (sin URL, sin includes).
 */
'use strict';

var http = require('http');
var https = require('https');
var urlModule = require('url');
var zlib = require('zlib');

var PORT = 8085;
var HOST = '127.0.0.1';
var ALLOWED_HOSTS = /(^|\.)(animeyt\.cc|mytsumi\.com|ok\.ru)$/i;
var USER_AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36';

// Reusar conexiones TLS: el handshake es lo más lento en el CPU del TV
var httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6 });
var httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6 });

// Caché en memoria de respuestas ya descomprimidas y limpias
var CACHE_TTL_MS = 5 * 60 * 1000;
var CACHE_MAX_ENTRIES = 40;
var cache = new Map();

function cacheGet(key) {
    var entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry;
}

function cacheSet(key, entry) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
    }
    entry.time = Date.now();
    cache.set(key, entry);
}

// La app solo lee el DOM: quitar scripts, estilos y SVG reduce ~1/3 lo que el TV parsea
function stripHtml(html) {
    return html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function sendEntry(res, entry) {
    setCorsHeaders(res);
    res.writeHead(entry.status, {
        'Content-Type': entry.contentType,
        'Content-Length': entry.body.length
    });
    res.end(entry.body);
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

function sendError(res, status, message) {
    if (res.headersSent) {
        res.end();
        return;
    }
    setCorsHeaders(res);
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(message);
}

function handleProxy(targetUrl, clientReq, clientRes, redirectCount, cacheKey) {
    if (redirectCount > 5) {
        sendError(clientRes, 502, 'Demasiadas redirecciones');
        return;
    }

    var parsed = urlModule.parse(targetUrl);
    if (!parsed.hostname || !ALLOWED_HOSTS.test(parsed.hostname)) {
        sendError(clientRes, 403, 'Host no permitido: ' + parsed.hostname);
        return;
    }

    var isHttps = parsed.protocol === 'https:';
    var client = isHttps ? https : http;

    var proxyReq = client.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: 'GET',
        agent: isHttps ? httpsAgent : httpAgent,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': clientReq.headers['accept'] || '*/*',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'Referer': 'https://animeyt.cc/'
        }
    }, function(proxyRes) {
        var status = proxyRes.statusCode;
        if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && proxyRes.headers.location) {
            proxyRes.resume();
            handleProxy(urlModule.resolve(targetUrl, proxyRes.headers.location), clientReq, clientRes, redirectCount + 1, cacheKey);
            return;
        }

        var stream = proxyRes;
        var encoding = proxyRes.headers['content-encoding'];
        if (encoding === 'gzip') {
            stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
            stream = proxyRes.pipe(zlib.createInflate());
        }

        var chunks = [];
        stream.on('data', function(chunk) { chunks.push(chunk); });
        stream.on('error', function(err) { sendError(clientRes, 502, 'Error descomprimiendo: ' + err.message); });
        stream.on('end', function() {
            var contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
            var body = Buffer.concat(chunks);
            if (/text\/html/i.test(contentType)) {
                body = new Buffer(stripHtml(body.toString('utf8')), 'utf8');
            }
            var entry = { status: status, contentType: contentType, body: body };
            if (status === 200) {
                cacheSet(cacheKey, entry);
            }
            sendEntry(clientRes, entry);
        });
    });

    proxyReq.setTimeout(25000, function() {
        proxyReq.abort();
        sendError(clientRes, 504, 'Timeout');
    });

    proxyReq.on('error', function(err) {
        sendError(clientRes, 502, 'Error del proxy: ' + err.message);
    });

    proxyReq.end();
}

var server = http.createServer(function(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    var parsed = urlModule.parse(req.url, true);
    if (parsed.pathname === '/ping') {
        setCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }

    if (parsed.pathname === '/proxy' && parsed.query.url) {
        var target = String(parsed.query.url);
        var cached = cacheGet(target);
        if (cached) {
            sendEntry(res, cached);
            return;
        }
        handleProxy(target, req, res, 0, target);
        return;
    }

    sendError(res, 404, 'Usa /proxy?url=<URL>');
});

// Si TizenBrew relanza el servicio y el puerto ya está tomado, el proxy anterior sigue sirviendo
server.on('error', function(err) {
    if (err.code !== 'EADDRINUSE') throw err;
});

server.listen(PORT, HOST);
