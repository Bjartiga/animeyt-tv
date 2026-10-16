/** Índice local de episodios. Consulta fichas completas, con dos solicitudes simultáneas. */
(function(window) {
    'use strict';
    const KEY = 'animeyt_series_v1', TTL = 15 * 60 * 1000;
    const inflight = {};
    function clean(url) { return String(url || '').split('#')[0].replace(/\/$/, ''); }
    function read() { return window.TVStorage._readJson(KEY, {}); }
    function number(ep) {
        const match = String(ep.episode || ep.title || '').match(/(?:episodio|cap[ií]tulo|ep\.?|e)?\s*(\d+(?:\.\d+)?)/i);
        return match ? Number(match[1]) : NaN;
    }
    const series = {
        get: function(url) { return read()[clean(url)] || null; },
        complete: function(url) {
            const p = window.TVStorage.getProgress(url);
            return window.TVStorage.isWatched(url) || !!(p && p.duration > 0 && p.time / p.duration >= 0.95);
        },
        remember: function(anime, requested) {
            if (!anime || !anime.url || !Array.isArray(anime.episodes)) return;
            const entries = read();
            const previous = entries[clean(requested || anime.url)];
            if (!anime.episodes.length && previous && previous.episodes.length) return;
            const episodes = anime.episodes.filter(e => e && e.url).map(e => ({ url: e.url, episode: e.episode || '', title: e.title || '', image: e.image || '' }));
            // No asumir el orden visual de la web; conservar especiales si no son numerables.
            if (episodes.length && episodes.every(e => isFinite(number(e)))) episodes.sort((a, b) => number(a) - number(b));
            const entry = { url: anime.url, title: anime.title || '', image: anime.poster || anime.image || '', malId: anime.malId || null, episodes: episodes, checked: Date.now() };
            entries[clean(anime.url)] = entry;
            if (requested) entries[clean(requested)] = entry;
            const keys = Object.keys(entries).sort((a, b) => entries[b].checked - entries[a].checked);
            keys.slice(150).forEach(k => { delete entries[k]; });
            window.TVStorage._writeJson(KEY, entries);
        },
        ensure: function(url) {
            const key = clean(url), cached = this.get(url);
            if (cached && Date.now() - cached.checked < TTL) return Promise.resolve(cached);
            if (!inflight[key]) inflight[key] = window.TVScraper.getAnimeDetail(url).then(anime => {
                this.remember(anime, url); return this.get(url);
            }).finally(() => { delete inflight[key]; });
            return inflight[key];
        },
        refresh: async function(active, update) {
            const history = window.TVStorage.getHistory().slice(0, 15);
            const queue = Array.from(new Set(history.map(h => h.animeUrl).concat(window.TVStorage.getFavorites().map(f => f.url)).filter(Boolean)));
            const worker = async () => {
                while (queue.length && active()) {
                    const url = queue.shift(), old = this.get(url);
                    try {
                        const entry = await this.ensure(url);
                        if (active() && (!old || entry.checked !== old.checked)) update();
                    } catch (error) { /* Conservar datos previos; un fallo no significa que no haya episodios. */ }
                }
            };
            await Promise.all([worker(), worker()]);
        },
        continuing: function() {
            const seen = new Set(), result = [];
            window.TVStorage.getHistory().forEach(h => {
                const key = clean(h.animeUrl || h.url);
                if (seen.has(key)) return;
                const p = window.TVStorage.getProgress(h.url);
                if (!this.complete(h.url)) {
                    if (p && p.time > 0) {
                        seen.add(key);
                        result.push(Object.assign({}, h, { resume: true }));
                    }
                    return;
                }
                seen.add(key);
                const entry = this.get(h.animeUrl);
                const index = entry ? entry.episodes.findIndex(e => e.url === h.url) : -1;
                const next = index >= 0 ? entry.episodes.slice(index + 1).find(e => !this.complete(e.url)) : null;
                if (next) result.push(Object.assign({}, h, next, { animeUrl: h.animeUrl, title: h.title, resume: false }));
                else if (!entry && h.nextUrl && !this.complete(h.nextUrl)) result.push(Object.assign({}, h, { url: h.nextUrl, episode: 'Siguiente episodio', resume: false }));
            });
            return result.slice(0, 15);
        },
        status: function(url) {
            const entry = this.get(url);
            if (!entry || !entry.episodes.length) return null;
            const history = window.TVStorage.getHistory();
            let anchor = -1;
            entry.episodes.forEach((ep, i) => {
                const progress = window.TVStorage.getProgress(ep.url);
                if (this.complete(ep.url) || (progress && progress.time > 0 && history.some(h => h.url === ep.url))) anchor = i;
            });
            const pending = entry.episodes.filter(e => !this.complete(e.url));
            const latest = entry.episodes[entry.episodes.length - 1];
            const fresh = anchor >= 0 && anchor < entry.episodes.length - 1 && !this.complete(latest.url);
            return { latest: latest, fresh: fresh, pending: pending.length, checked: entry.checked };
        }
    };
    window.TVSeries = series;
})(window);
