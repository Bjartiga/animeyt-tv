/** Tiempos por episodio, compartidos entre fuentes solo con duración compatible. */
(function(window) {
    'use strict';
    const KEY = 'animeyt_skip_v1', inflight = {};
    function normalized(title) {
        return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    function cached(key) {
        const entry = window.TVStorage._readJson(KEY, {})[key];
        return entry && entry.expires > Date.now() ? entry.value : undefined;
    }
    function save(key, value, hours) {
        const data = window.TVStorage._readJson(KEY, {});
        data[key] = { value: value, expires: Date.now() + hours * 3600000 };
        Object.keys(data).sort((a, b) => data[b].expires - data[a].expires).slice(200).forEach(k => { delete data[k]; });
        window.TVStorage._writeJson(KEY, data);
    }
    async function json(url, options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(window.TVNet.url(url), Object.assign({ credentials: 'omit' }, options || {}, { signal: controller.signal }));
            if (!response.ok) throw new Error('Skip metadata HTTP ' + response.status);
            return await response.json();
        } finally { clearTimeout(timeout); }
    }
    async function malId(episode) {
        const entry = window.TVSeries ? window.TVSeries.get(episode.animeUrl) || await window.TVSeries.ensure(episode.animeUrl) : null;
        if (!entry) return null;
        if (entry.malId) return entry.malId;
        const key = 'mal:' + entry.url;
        const previous = cached(key);
        if (previous !== undefined) return previous;
        if (!normalized(entry.title)) return null;
        const response = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: 'query($search:String){Page(perPage:10){media(search:$search,type:ANIME){idMal title{romaji english native} synonyms}}}', variables: { search: entry.title } }) });
        if (response.errors || !response.data || !response.data.Page) return null;
        const matches = response.data.Page.media.filter(media => media.idMal &&
            [media.title.romaji, media.title.english, media.title.native].concat(media.synonyms || []).some(title => normalized(title) === normalized(entry.title)));
        const ids = Array.from(new Set(matches.map(media => media.idMal)));
        // Nunca elegir automáticamente la primera coincidencia aproximada o mezclar temporadas.
        const id = ids.length === 1 ? ids[0] : null;
        save(key, id, id ? 24 * 30 : 6);
        return id;
    }
    function compatible(result, duration) {
        if (!result || !result.interval || !['op', 'recap'].includes(result.skipType)) return false;
        const start = result.interval.startTime, end = result.interval.endTime;
        return typeof start === 'number' && typeof end === 'number' && isFinite(start) && isFinite(end) &&
            start >= 0 && end > start && end < duration && isFinite(result.episodeLength) && Math.abs(result.episodeLength - duration) <= 2;
    }
    window.TVSkip = {
        episodeNumber: function(episode) {
            const path = String(episode.url || '').match(/(?:capitulo|episodio)-(\d+(?:\.\d+)?)(?:[\/#?_-]|$)/i);
            const label = String(episode.episode || '').match(/^(?:ep\.?|episodio|cap[ií]tulo)?\s*(\d+(?:\.\d+)?)(?:\s|$)/i);
            return path ? Number(path[1]) : label ? Number(label[1]) : null;
        },
        compatible: compatible,
        load: function(episode, duration) {
            if (!episode || !episode.animeUrl || !isFinite(duration) || duration <= 0) return Promise.resolve([]);
            const n = this.episodeNumber(episode);
            if (!n || n % 1) return Promise.resolve([]); // Especiales y numeración ambigua requieren mapeo explícito.
            const key = episode.url + ':' + Math.round(duration);
            if (!inflight[key]) inflight[key] = (async () => {
                const id = await malId(episode);
                if (!id) return [];
                const cacheKey = 'times:' + id + ':' + n + ':' + Math.round(duration);
                let response = cached(cacheKey);
                if (response === undefined) {
                    response = await json('https://api.aniskip.com/v2/skip-times/' + id + '/' + n + '?types%5B%5D=op&types%5B%5D=recap&episodeLength=' + duration.toFixed(3));
                    if (response && typeof response.found === 'boolean') save(cacheKey, response, response.found ? 24 : 1);
                }
                if (!response || !response.found || !Array.isArray(response.results)) return [];
                return response.results.filter(r => compatible(r, duration)).map(r => ({ start: r.interval.startTime, end: r.interval.endTime, type: r.skipType, duration: r.episodeLength, source: 'AniSkip' })).sort((a, b) => a.start - b.start);
            })().catch(() => []).finally(() => { delete inflight[key]; });
            return inflight[key];
        }
    };
})(window);
