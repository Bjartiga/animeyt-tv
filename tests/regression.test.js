'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function environment() {
    const elements = new Map(), data = new Map(), timers = new Map(), callbacks = {};
    let timerId = 0;
    function element(tag = 'div') {
        return { tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, events: {}, classList: { add() {}, remove() {}, toggle() {} },
            innerHTML: '', textContent: '', duration: 1000, currentTime: 0, paused: false, ended: false,
            appendChild(child) { this.children.push(child); }, setAttribute(k, v) { this[k] = v; }, removeAttribute() {},
            addEventListener(k, f) { (this.events[k] || (this.events[k] = [])).push(f); },
            emit(k) { (this.events[k] || []).forEach(f => f()); }, pause() { this.paused = true; this.emit('pause'); },
            play() { this.paused = false; return Promise.resolve(); }, load() {}, remove() {},
            focus() { document.activeElement = this; }, blur() { if (document.activeElement === this) document.activeElement = null; },
            querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }
        };
    }
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        querySelector() { return null; }, querySelectorAll() { return []; }, createElement: element,
        documentElement: { contains() { return true; } } };
    const window = { addEventListener(n, f) { callbacks[n] = f; }, removeEventListener() {}, focus() {}, location: { hash: '#/search', protocol: 'file:', host: '' } };
    const context = vm.createContext({ window, document, console: { log() {}, error() {}, warn() {} }, URL, URLSearchParams, AbortController, atob,
        history: { replaceState(a, b, route) { window.location.hash = route; } },
        setTimeout(f, ms) { const id = ++timerId; timers.set(id, { f, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
        setInterval() { return ++timerId; }, clearInterval() {},
        localStorage: { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) } });
    const read = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context);
    ['js/keys.js', 'js/storage.js', 'js/scraper.js', 'js/player.js'].forEach(read);
    function app() {
        vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').replace('window.app.init();', ''), context);
        callbacks.DOMContentLoaded(); const a = window.app; a.currentRoute = '#/search'; a.viewStack = ['#/search'];
        a.nav = { refreshFocus() {} }; a.player = { isPlaying: false };
        window.TVUI = { switchView() {}, showLoading() {}, showToast() {}, renderSearchResults() {}, setSearchStatus() {}, setSearchQuery() {}, renderAnimeDetail() {}, renderCatalog() {}, renderCatalogFilters() {} };
        return a;
    }
    return { window, document, context, elements, data, timers, read, app };
}
function playing(env) { const p = new env.window.TVPlayer(); p.isPlaying = true; p.currentEpisode = { url: 'ep' }; p.servers = [{ url: 'https://ok.ru/videoembed/1', label: 'OK' }]; return p; }
const sources = [{ url: 'https://cdn/1080.mp4', type: 'video/mp4', quality: 'full' }, { url: 'https://cdn/720.mp4', type: 'video/mp4', quality: 'hd' }];
test('an error tries the next quality and preserves the exact position', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({ sources });
    p._mountNative(p.servers[0]); await flush(); p.video.currentTime = 321; p.video.emit('error'); await flush();
    assert.equal(p.streamSourceIndex, 1); p.video.emit('loadedmetadata'); assert.equal(p.video.currentTime, 321);
    assert.equal(e.window.TVStorage.getProgress('ep').time, 321); p.destroy();
});
test('a video that stops advancing has a bounded recovery timeout', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({ sources });
    p._mountNative(p.servers[0]); await flush(); const timer = [...e.timers.values()].find(t => t.ms === 20000); assert.ok(timer);
    timer.f(); await flush(); assert.equal(p.streamSourceIndex, 1); p.destroy();
});
test('pause clears recovery and intentional pause does not switch quality', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({ sources });
    p._mountNative(p.servers[0]); await flush(); p.video.pause(); assert.equal(p.recoveryTimer, null); assert.equal(p.streamSourceIndex, 0); p.destroy();
});
test('changing servers resumes at the same second', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({ sources });
    p.servers.push({ url: 'https://archive.org/x.mp4', label: 'Omega' }); p._mountNative(p.servers[0]); await flush();
    p.video.currentTime = 122; p.switchServer(1); await flush(); p.video.emit('loadedmetadata'); assert.equal(p.video.currentTime, 122); p.destroy();
});
test('late events from the removed video do not write progress or affect new playback', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({ sources });
    p._mountNative(p.servers[0]); await flush(); const old = p.video; old.currentTime = 345;
    p.selectQuality(1); await flush(); old.emit('pause'); old.emit('ended');
    assert.equal(e.window.TVStorage.getProgress('ep').time, 345); assert.ok(!p._nextPromptUrl); p.destroy();
});
test('closing invalidates pending episode loading', async () => {
    const e = environment(), p = playing(e), d = deferred(); let mounts = 0;
    e.window.TVScraper.getEpisodeContainer = () => d.promise; p._mountCurrentServer = () => mounts++;
    const request = p.loadEpisode({ url: 'A' }); p.destroy(); d.resolve({ containerId: 'A' }); await request; assert.equal(mounts, 0);
});
test('typing another letter invalidates search before the debounce fires', async () => {
    const e = environment(), app = e.app(), d = deferred(); let renders = 0; e.window.TVApi = { search: () => d.promise };
    e.window.TVUI.renderSearchResults = () => renders++; app.searchQuery = 'naruto'; const pending = app._executeSearch('naruto');
    app._onKeyboardKey('a'); d.resolve([]); await pending; assert.equal(renders, 0); assert.equal(app.currentRoute, '#/search?q=narutoa');
});
test('same-route filter loads discard the older request and its spinner completion', async () => {
    const e = environment(), app = e.app(), a = deferred(), b = deferred(), rendered = []; let n = 0;
    e.window.TVScraper.getCatalog = () => (++n === 1 ? a.promise : b.promise); e.window.TVUI.renderCatalog = d => rendered.push(d.id);
    const first = app._loadCatalogView({ page: 1 }); const second = app._loadCatalogView({ page: 1 });
    b.resolve({ id: 'new' }); await second; a.resolve({ id: 'old' }); await first; assert.deepEqual(rendered, ['new']);
});
test('Home renders without waiting for optional ranking', async () => {
    const e = environment(), app = e.app(), d = deferred(); let rendered = false;
    e.window.TVScraper.getHomeContent = async () => ({ episodes: [] }); e.window.TVScraper.getRanking = () => d.promise;
    e.window.TVUI.renderHome = () => rendered = true; await app._loadHomeView(); assert.equal(rendered, true);
});
test('search transport errors are distinct from an empty search result', async () => {
    const e = environment(); e.read('js/api.js'); e.context.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(e.window.TVApi.search('test'), /503/); assert.equal(e.timers.size, 0);
});
test('removing history deletes only its progress and preserves watched status and favorites', () => {
    const e = environment(), s = e.window.TVStorage; s.addToHistory({ url: 'a' }); s.addToHistory({ url: 'b' });
    s.saveProgress('a', 50, 100); s.saveProgress('b', 25, 100); s.setWatched('a', true); s.toggleFavorite({ url: 'series' }); s.removeHistory('a');
    assert.equal(s.getHistory().length, 1); assert.equal(s.getProgress('a'), null); assert.equal(s.getProgress('b').time, 25);
    assert.equal(s.isWatched('a'), true); assert.equal(s.isFavorite('series'), true);
});
test('WebM receives the correct MIME type', async () => {
    const e = environment(); assert.equal((await e.window.TVScraper.resolveDirectStream({ url: 'https://cdn/x.webm' })).type, 'video/webm');
});
test('episode filtering matches episode 2 without including 12 and supports descending order', () => {
    const e = environment(); e.read('js/ui.js'); const ui = e.window.TVUI;
    ui.detailAnime = { url: 'serie', title: 'Serie', episodes: [{ url: 'ep12', episode: 'EP 12' }, { url: 'ep2', episode: 'EP 2' }, { url: 'ep1', episode: 'EP 1' }] };
    ui.renderEpisodeList('2'); let html = e.elements.get('detail-episode-list').innerHTML;
    assert.match(html, /data-url="ep2"/); assert.doesNotMatch(html, /data-url="ep12"/);
    ui.episodeDescending = true; ui.renderEpisodeList(''); html = e.elements.get('detail-episode-list').innerHTML;
    assert.ok(html.indexOf('ep12') < html.indexOf('ep1"'));
});
test('history retains different episodes of the same series', () => {
    const e = environment(), s = e.window.TVStorage;
    s.addToHistory({ url: 'ep1', animeUrl: 'series' }); s.addToHistory({ url: 'ep2', animeUrl: 'series' }); s.addToHistory({ url: 'ep1', animeUrl: 'series' });
    assert.equal(s.getHistory().length, 2); assert.equal(s.getHistory()[0].url, 'ep1');
});
test('all qualities failing falls back to the next direct server before an iframe', async () => {
    const e = environment(), p = playing(e); p.servers.push({url:'https://archive.org/other.mp4',label:'Omega'});
    e.window.TVScraper.resolveDirectStream = async () => ({sources}); p._mountNative(p.servers[0]); await flush();
    p.video.emit('error'); await flush(); p.video.emit('error'); await flush();
    assert.equal(p.currentServerIndex, 1); assert.equal(p.streamSourceIndex, 0); p.destroy();
});
test('closing cancels a pending recovery timeout', async () => {
    const e = environment(), p = playing(e); e.window.TVScraper.resolveDirectStream = async () => ({sources});
    p._mountNative(p.servers[0]); await flush(); p.destroy();
    assert.equal([...e.timers.values()].filter(t => t.ms === 20000).length, 0);
});
test('late server-list response cannot overwrite another episode', async () => {
    const e = environment(), p = playing(e), a = deferred();
    e.window.TVScraper.getEpisodeContainer = async url => ({containerId:url,nextUrl:url+'-next'});
    e.window.TVScraper.getVideoServers = id => id === 'A' ? a.promise : Promise.resolve({servers:[{url:'https://example.org/B.mp4',label:'B'}]});
    p._mountCurrentServer = () => {};
    const first = p.loadEpisode({url:'A'}); await flush(); await p.loadEpisode({url:'B'});
    a.resolve({servers:[{url:'https://example.org/A.mp4',label:'A'}]}); await first;
    assert.equal(p.currentEpisode.nextUrl,'B-next'); assert.equal(p.servers[0].label,'B'); p.destroy();
});
test('OK exposes lower qualities in the preferred order for recovery', async () => {
    const e = environment(); const metadata = {videos:[{name:'full',url:'https://cdn/full.mp4'},{name:'hd',url:'https://cdn/hd.mp4'},{name:'sd',url:'https://cdn/sd.mp4'}]};
    e.window.TVNet = {url:u=>u,credentials:()=> 'include'};
    e.context.fetch = async () => ({ok:true,text:async()=>'<html></html>'});
    e.context.DOMParser = class {parseFromString(){return {querySelector:()=>({getAttribute:()=>JSON.stringify({flashvars:{metadata:JSON.stringify(metadata)}})})};}};
    e.window.TVStorage.saveSettings({preferredQuality:'720p'});
    const stream = await e.window.TVScraper.resolveDirectStream({url:'https://ok.ru/videoembed/1'});
    assert.equal(stream.quality,'hd'); assert.equal(stream.sources[1].quality,'sd'); assert.equal(stream.sources[2].quality,'full');
});
test('Mytsumi offers selectable sources rather than discarding all other qualities', async () => {
    const e = environment(); e.window.TVNet = {url:u=>u,credentials:()=> 'include'};
    e.context.fetch = async () => ({ok:true,text:async()=> 'const qualities = {"1080p":"https://cdn/1080.mp4","720p":"https://cdn/720.mp4","480p":"https://cdn/480.mp4"};'});
    e.window.TVStorage.saveSettings({preferredQuality:'720p'});
    const stream = await e.window.TVScraper.resolveDirectStream({url:'https://mytsumi.com/multiplayer/play2026/player.php?data=x'});
    assert.equal(stream.quality,'720p'); assert.equal(stream.sources.length,3); assert.equal(stream.sources[1].quality,'480p');
});
test('returning to search executes the query whose debounce was cancelled by navigation', async () => {
    const e = environment(), app = e.app(); let requested;
    e.window.TVUI.renderKeyboard = () => {}; app.searchQuery = 'narutoa'; app.searchResultsQuery = 'naruto';
    e.window.TVApi = {search:async q=>{requested=q;return [];}};
    await app._loadSearchView({q:'narutoa'}); assert.equal(requested,'narutoa'); assert.equal(app.searchResultsQuery,'narutoa');
});
test('web interaction lends focus temporarily and restores app navigation', () => {
    const e = environment(), p = playing(e); e.window.appNavigation = { enabled:true, refreshFocus() {} };
    p._mountIframe({url:'https://example.org/embed',label:'Web'}); const iframe = p.iframe;
    p.activateWebControl(); assert.equal(p.webInteraction,true); assert.equal(e.window.appNavigation.enabled,false);
    assert.equal(e.document.activeElement,iframe);
    const lease = e.timers.get(p.webControlTimer); lease.f();
    assert.equal(p.webInteraction,false); assert.equal(e.window.appNavigation.enabled,true); assert.equal(p.iframe,iframe); p.destroy();
});
test('destroying an iframe cancels interaction and load timers', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'https://example.org/embed',label:'Web'}); p.activateWebControl(); p.destroy();
    assert.equal(p.webInteraction,false); assert.equal(p.webControlTimer,null); assert.equal(p.webLoadTimer,null);
    assert.equal([...e.timers.values()].filter(t=>t.ms===15000).length,0);
});
test('iframe load does not claim successful playback or expose native controls', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'https://example.org/embed',label:'Web'}); p.iframe.emit('load');
    assert.match(e.elements.get('player-web-status').textContent,/Página abierta/); assert.equal(p.playbackMode,'web'); assert.equal(p.video,null); p.destroy();
});
test('stale iframe callbacks cannot change status after another mount', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'https://example.org/embed',label:'Web'}); const old = p.iframe;
    p._teardownMedia(); e.elements.get('player-web-status').textContent='new'; old.emit('load'); old.emit('error');
    assert.equal(e.elements.get('player-web-status').textContent,'new'); p.destroy();
});
test('web embedding retains restrictions on popups and top navigation', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'https://example.org/embed',label:'Web'});
    assert.doesNotMatch(p.iframe.sandbox,/allow-popups|allow-top-navigation/); assert.match(p.iframe.sandbox,/allow-scripts/); p.destroy();
});
test('signed embed URLs and Mega fragments are preserved exactly', () => {
    const e = environment(), p = playing(e); const mega='https://mega.nz/embed/ID#secret-key';
    assert.equal(p._enhanceAutoplayUrl(mega),mega);
    const signed='https://example.org/embed?id=1&signature=a%2Bb#video'; assert.equal(p._enhanceAutoplayUrl(signed),signed);
    const ok=p._enhanceAutoplayUrl('https://ok.ru/videoembed/1'); assert.match(ok,/autoplay=1/); assert.doesNotMatch(ok,/[?&]auto=/); p.destroy();
});
test('Back in web control mode restores the app instead of closing the episode', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'https://example.org/embed',label:'Web'}); p.activateWebControl();
    p._handlePlayerKeys({keyCode:10009,preventDefault(){},stopPropagation(){}});
    assert.equal(p.webInteraction,false); assert.equal(p.isPlaying,true); assert.ok(p.iframe); p.destroy();
});
test('invalid iframe schemes are rejected before mounting', () => {
    const e = environment(), p = playing(e); p._mountIframe({url:'javascript:alert(1)',label:'Web'}); assert.equal(p.iframe,null); p.destroy();
});
test('opening a web server in the browser stops its iframe and leaves recovery options available', () => {
    const e = environment(), p = playing(e); let opened;
    p.servers=[{url:'https://example.org/player?id=1#token',label:'Web'}]; p.currentEpisode.containerUrl='https://example.org/list';
    e.window.open=url=>opened=url;
    p._mountIframe(p.servers[0]); p.openInBrowser(true);
    assert.equal(opened,p.servers[0].url); assert.equal(p.iframe,null); assert.equal(p.isServerBarVisible,true); p.destroy();
});

test('Epsilon decodes its public API and preserves signed variant URLs in preferred order', async () => {
    const e = environment(), crypto = require('node:crypto');
    e.window.crypto = crypto.webcrypto;
    e.context.TextDecoder = TextDecoder;
    e.window.TVNet = { url: u => u, credentials: () => 'omit' };
    const key = Buffer.from([107,105,101,109,116,105,101,110,109,117,97,57,49,49,99,97]);
    const iv = Buffer.from([49,50,51,52,53,54,55,56,57,48,111,105,117,121,116,114]);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const encoded = Buffer.concat([cipher.update(JSON.stringify({ cfNative: 'https://cdn.example/master.m3u8?k=master' })), cipher.final()]).toString('hex');
    const calls = [];
    e.context.fetch = async u => { calls.push(u); return { ok: true, text: async () => u.includes('/api/') ? encoded : '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8?k=child%2B&kx=123\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080.m3u8?k=other\n' }; };
    e.window.TVStorage.getSettings = () => ({ preferredQuality: '720' });
    const result = await e.window.TVScraper.resolveDirectStream({ url: 'https://ytplay.rpmvid.com/#abc123' });
    assert.equal(result.quality, '720p');
    assert.equal(result.url, 'https://cdn.example/720.m3u8?k=child%2B&kx=123');
    assert.equal(result.sources[1].quality, '1080p');
    assert.equal(calls.length, 2);
    assert.equal(e.window.TVScraper.canPlayDirect({ url: 'https://ytplay.rpmvid.com.evil/#abc' }), false);
});

test('Epsilon rejects changed API formats and unavailable WebCrypto', async () => {
    const e = environment();
    await assert.rejects(e.window.TVScraper.resolveDirectStream({ url: 'https://ytplay.rpmvid.com/#abc' }), /WebCrypto/);
    e.window.crypto = require('node:crypto').webcrypto;
    e.window.TVNet = { url: u => u, credentials: () => 'omit' };
    e.context.fetch = async () => ({ ok: true, text: async () => '<html>verification</html>' });
    await assert.rejects(e.window.TVScraper.resolveDirectStream({ url: 'https://ytplay.rpmvid.com/#abc' }), /formato/);
});

function avplayEnvironment() {
    const e = environment(), calls = [];
    let listener, prepare, seek;
    const api = {
        open(u) { calls.push(['open', u]); }, setListener(l) { listener = l; }, setDisplayRect() {}, setDisplayMethod() {},
        prepareAsync(ok) { prepare = ok; }, getDuration() { return 600000; },
        play() { calls.push(['play']); }, pause() { calls.push(['pause']); },
        seekTo(ms, ok) { calls.push(['seek', ms]); seek = ok; }, stop() { calls.push(['stop']); }, close() { calls.push(['close']); }
    };
    e.window.webapis = { avplay: api }; e.read('js/avplay.js');
    return { e, calls, api, listener: () => listener, prepare: () => prepare(), seek: () => seek() };
}
test('AVPlay resumes in milliseconds before playback and ignores preparation after destroy', async () => {
    const a = avplayEnvironment(), media = a.e.window.TVAVPlay.create({ url: 'https://cdn/master.m3u8' });
    media.addEventListener('loadedmetadata', () => { media.currentTime = 123; });
    await media.play(); a.prepare();
    assert.deepEqual(a.calls.map(c => c[0]), ['open', 'seek']);
    assert.equal(a.calls[1][1], 123000); a.seek();
    assert.equal(a.calls[2][0], 'play');
    a.listener().oncurrentplaytime(124000); assert.equal(media.currentTime, 124);
    media.pause(); assert.equal(media.paused, true);
    media.destroyMedia(); const count = a.calls.length;
    a.prepare(); a.listener().oncurrentplaytime(999000);
    assert.equal(a.calls.length, count); assert.equal(media.currentTime, 124);
    assert.deepEqual(a.calls.slice(-2).map(c => c[0]), ['stop', 'close']);
});

test('the player uses AVPlay for HLS and closes it when changing servers', async () => {
    const a = avplayEnvironment(), p = playing(a.e);
    a.e.window.TVScraper.resolveDirectStream = async () => ({ url: 'https://cdn/master.m3u8', type: 'application/x-mpegURL', quality: '720p' });
    p._mountNative(p.servers[0]); await flush();
    assert.equal(p.video.type, 'application/avplayer'); a.prepare();
    a.listener().oncurrentplaytime(45000);
    assert.equal(p.playbackMode, 'direct');
    p.destroy();
    assert.deepEqual(a.calls.slice(-2).map(c => c[0]), ['stop', 'close']);
    assert.equal(a.e.window.TVAVPlay.supports({ type: 'video/mp4' }), false);
});

test('pausing while AVPlay prepares prevents autoplay and cancels recovery', async () => {
    const a = avplayEnvironment(), p = playing(a.e);
    a.e.window.TVScraper.resolveDirectStream = async () => ({ url: 'https://cdn/master.m3u8', type: 'application/x-mpegURL', quality: '720p' });
    p._mountNative(p.servers[0]); await flush();
    p.video.pause(); assert.equal(p.recoveryTimer, null);
    a.listener().onbufferingstart(); assert.equal(p.recoveryTimer, null);
    a.prepare(); assert.equal(a.calls.some(c => c[0] === 'play'), false);
    await p.video.play(); assert.equal(a.calls.some(c => c[0] === 'play'), true);
    p.destroy();
});

function seriesEnvironment() {
    const e = environment(); e.read('js/series.js'); e.read('js/skip.js'); return e;
}
function rememberEpisodes(e, count = 3) {
    const episodes = Array.from({ length: count }, (_, i) => ({ url: 'ep' + (i + 1), episode: 'EP ' + (i + 1), title: 'Episode ' + (i + 1) }));
    e.window.TVSeries.remember({ url: 'https://animeyt.cc/tv/example/', title: 'Example', episodes: episodes.slice().reverse() });
    return episodes;
}
test('completed episodes become the next available episode in Continue Watching', () => {
    const e = seriesEnvironment(), storage = e.window.TVStorage;
    rememberEpisodes(e); storage.addToHistory({ url: 'ep2', animeUrl: 'https://animeyt.cc/tv/example/', title: 'Example' });
    storage.saveProgress('ep2', 950, 1000);
    assert.equal(e.window.TVSeries.continuing()[0].url, 'ep3');
    assert.equal(e.window.TVSeries.continuing()[0].resume, false);
    storage.saveProgress('ep2', 949, 1000);
    assert.equal(e.window.TVSeries.continuing()[0].url, 'ep2');
    assert.equal(e.window.TVSeries.continuing()[0].resume, true);
});
test('a caught-up series returns when an episode appears outside the homepage feed', () => {
    const e = seriesEnvironment(), storage = e.window.TVStorage;
    rememberEpisodes(e, 2); storage.addToHistory({ url: 'ep2', animeUrl: 'https://animeyt.cc/tv/example/', title: 'Example' }); storage.setWatched('ep2', true);
    assert.equal(e.window.TVSeries.continuing().length, 0);
    assert.equal(e.window.TVSeries.status('https://animeyt.cc/tv/example/').fresh, false);
    rememberEpisodes(e, 3);
    assert.equal(e.window.TVSeries.continuing()[0].url, 'ep3');
    assert.equal(e.window.TVSeries.status('https://animeyt.cc/tv/example/').fresh, true);
    storage.setWatched('ep3', true);
    assert.equal(e.window.TVSeries.status('https://animeyt.cc/tv/example/').fresh, false);
});
test('series continuation does not resurrect older unfinished chapters behind a completed latest one', () => {
    const e = seriesEnvironment(), s = e.window.TVStorage; rememberEpisodes(e);
    s.addToHistory({ url: 'ep1', animeUrl: 'https://animeyt.cc/tv/example/' }); s.saveProgress('ep1', 100, 1000);
    s.addToHistory({ url: 'ep3', animeUrl: 'https://animeyt.cc/tv/example/' }); s.setWatched('ep3', true);
    assert.equal(e.window.TVSeries.continuing().length, 0);
});
test('background series refresh is bounded and stops scheduling after leaving the view', async () => {
    const e = seriesEnvironment(), waits = [], started = []; let active = true, updated = 0;
    ['one', 'two', 'three'].forEach(url => e.window.TVStorage.toggleFavorite({ url }));
    e.window.TVScraper.getAnimeDetail = url => { started.push(url); const d = deferred(); waits.push({ d, url }); return d.promise; };
    const refresh = e.window.TVSeries.refresh(() => active, () => updated++);
    assert.equal(started.length, 2); active = false;
    waits.forEach(({ d, url }) => d.resolve({ url, episodes: [] })); await refresh;
    assert.equal(started.length, 2); assert.equal(updated, 0);
});
test('AniSkip uses exact identity, caches metadata across servers and rejects a different runtime', async () => {
    const e = seriesEnvironment(), calls = [];
    e.window.TVSeries.remember({ url: 'series', title: 'Shingeki no Kyojin', episodes: [] });
    e.window.TVNet = { url: u => u };
    e.context.fetch = async (url, options) => {
        calls.push(url);
        if (url.includes('anilist')) {
            assert.equal(options.method, 'POST');
            return { ok: true, json: async () => ({ data: { Page: { media: [{ idMal: 16498, title: { romaji: 'Shingeki no Kyojin' }, synonyms: [] }] } } }) };
        }
        return { ok: true, json: async () => ({ found: true, results: [{ skipType: 'op', interval: { startTime: 47.365, endTime: 137.365 }, episodeLength: 1540.061 }] }) };
    };
    const ep = { url: 'https://animeyt.cc/1/anime/test-capitulo-1/', animeUrl: 'series' };
    assert.equal((await e.window.TVSkip.load(ep, 1540))[0].end, 137.365);
    assert.equal((await e.window.TVSkip.load(ep, 1540)).length, 1);
    assert.equal(calls.length, 2);
    assert.equal((await e.window.TVSkip.load(ep, 1500)).length, 0);
});
test('ambiguous anime identity never requests timestamps for a guessed season', async () => {
    const e = seriesEnvironment(); let requests = 0;
    e.window.TVSeries.remember({ url: 'series', title: 'Example', episodes: [] }); e.window.TVNet = { url: u => u };
    e.context.fetch = async () => { requests++; return { ok: true, json: async () => ({ data: { Page: { media: [1, 2].map(idMal => ({ idMal, title: { romaji: 'Example' } })) } } }) }; };
    assert.equal((await e.window.TVSkip.load({ url: '/capitulo-1/', animeUrl: 'series' }, 1400)).length, 0);
    assert.equal(requests, 1);
});
test('skip prompt only appears inside its interval and OK seeks to the real endpoint', () => {
    const e = seriesEnvironment(), p = playing(e); p.video = e.document.createElement('video');
    p.skipSegments = [{ start: 40, end: 132, type: 'op' }];
    p.video.currentTime = 39; p._updateSkipPrompt(); assert.equal(e.document.getElementById('player-skip').hidden, true);
    p.video.currentTime = 50; p._updateSkipPrompt(); assert.equal(e.document.getElementById('player-skip').hidden, false);
    p._handlePlayerKeys({ keyCode: e.window.TVKeys.ENTER, preventDefault() {}, stopPropagation() {} });
    assert.equal(p.video.currentTime, 132); assert.equal(p.video.paused, false); assert.equal(e.document.getElementById('player-skip').hidden, true);
    p.video.currentTime = 60; p.isServerBarVisible = true; p._updateSkipPrompt(); assert.equal(p.activeSkip, null);
    p.destroy();
});
test('late skip metadata cannot show a prompt on the next source', async () => {
    const e = seriesEnvironment(), p = playing(e), request = deferred();
    p.video = e.document.createElement('video'); p.video.currentTime = 50;
    e.window.TVSkip.load = () => request.promise;
    const pending = p._loadSkipSegments(p.mountToken); p._teardownMedia();
    request.resolve([{ start: 40, end: 130, type: 'op' }]); await pending;
    assert.equal(p.skipSegments.length, 0); assert.equal(p.activeSkip, null);
});

test('opening a server without playback does not erase continuation or dismiss the new episode badge', () => {
    const e = seriesEnvironment(), s = e.window.TVStorage; rememberEpisodes(e);
    s.addToHistory({ url: 'ep2', animeUrl: 'https://animeyt.cc/tv/example/' }); s.saveProgress('ep2', 500, 1000);
    s.addToHistory({ url: 'ep3', animeUrl: 'https://animeyt.cc/tv/example/' });
    assert.equal(e.window.TVSeries.continuing()[0].url, 'ep2');
    assert.equal(e.window.TVSeries.status('https://animeyt.cc/tv/example/').fresh, true);
});
test('an empty detail response does not erase a previously verified episode list', () => {
    const e = seriesEnvironment(); rememberEpisodes(e);
    e.window.TVSeries.remember({ url: 'https://animeyt.cc/tv/example/', title: '', episodes: [] });
    assert.equal(e.window.TVSeries.get('https://animeyt.cc/tv/example/').episodes.length, 3);
});
