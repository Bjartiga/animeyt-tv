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
var ALLOWED_HOSTS = /(^|\.)(animeyt\.cc|mytsumi\.com)$/i;
var USER_AGENT = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36';

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

function handleProxy(targetUrl, clientReq, clientRes, redirectCount) {
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
            handleProxy(urlModule.resolve(targetUrl, proxyRes.headers.location), clientReq, clientRes, redirectCount + 1);
            return;
        }

        setCorsHeaders(clientRes);
        if (proxyRes.headers['content-type']) {
            clientRes.setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        clientRes.writeHead(status);

        var encoding = proxyRes.headers['content-encoding'];
        if (encoding === 'gzip') {
            proxyRes.pipe(zlib.createGunzip()).pipe(clientRes);
        } else if (encoding === 'deflate') {
            proxyRes.pipe(zlib.createInflate()).pipe(clientRes);
        } else {
            proxyRes.pipe(clientRes);
        }
    });

    proxyReq.setTimeout(15000, function() {
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
        handleProxy(String(parsed.query.url), req, res, 0);
        return;
    }

    sendError(res, 404, 'Usa /proxy?url=<URL>');
});

// Si TizenBrew relanza el servicio y el puerto ya está tomado, el proxy anterior sigue sirviendo
server.on('error', function(err) {
    if (err.code !== 'EADDRINUSE') throw err;
});

server.listen(PORT, HOST);
