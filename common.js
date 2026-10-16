/* Firsthill stock tracker · shared code used by every page */

// ---------- CONFIG: your Apps Script web app URL (only place you need to change it) ----------
const FH_API_URL = 'https://script.google.com/macros/s/AKfycbx38ZGyDhFH3GWodo4SsJRvPIuifCr2vPF0vlG6WNJIS4fO-ysNPgAA79p8ZLJBXkCTMQ/exec';

const FH = (() => {
    const TOKEN_KEY = 'fh_token';
    const USER_KEY = 'fh_user';
    const DAY = 86400000;

    function save(key, value) {
        try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) {}
    }
    function read(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    // ---------- language (English / 中文) ----------
    // Translations live in i18n.js. Static text and fixed labels are translated automatically as they
    // appear on the page; sentences with numbers or names go through t('... {name} ...', { name }).
    const LANG_KEY = 'fh_lang';
    function lang() { return read(LANG_KEY) === 'zh' ? 'zh' : 'en'; }
    function locale() { return lang() === 'zh' ? 'zh-CN' : 'en-GB'; }
    function zh() { return (lang() === 'zh' && typeof FH_ZH !== 'undefined') ? FH_ZH : null; }
    function fill(s, vars) {
        return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
    }
    /** Translate a string. Use {placeholders} for anything that changes, e.g. t('{n} in stock', { n: 4 }). */
    function t(s, vars) {
        const d = zh();
        return fill(d && d[s] != null ? d[s] : s, vars);
    }
    /** Pick the singular or plural English text by n, then translate. n is available as {n}. */
    function tp(n, one, many, vars) { return t(n === 1 ? one : many, Object.assign({ n }, vars)); }
    /** Translate a message that came back from the server (exact text first, then patterns with names/numbers). */
    function tMsg(msg) {
        msg = String(msg ?? '');
        const d = zh();
        if (!d) return msg;
        if (d[msg] != null) return d[msg];
        for (const [re, out] of (typeof FH_ZH_PATTERNS !== 'undefined' ? FH_ZH_PATTERNS : [])) {
            if (re.test(msg)) return msg.replace(re, out);
        }
        return msg;
    }
    function setLang(l) { save(LANG_KEY, l === 'zh' ? 'zh' : 'en'); location.reload(); }
    function langButtonHtml(cls = 'nav-link') {
        return `<button type="button" class="${cls} lang-toggle" data-fh-lang title="${lang() === 'zh' ? 'Switch to English' : '切换到中文'}">
            <i class="fas fa-language"></i> ${lang() === 'zh' ? 'English' : '中文'}</button>`;
    }

    const I18N_ATTRS = ['placeholder', 'title', 'aria-label', 'data-label', 'label'];
    function translateTree(root) {
        const d = zh();
        if (!d || !root) return;
        if (root.nodeType === 3) {
            const v = root.nodeValue, k = v.trim();
            if (k && d[k] != null) root.nodeValue = v.replace(k, d[k]);
            return;
        }
        if (root.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(root.nodeName)) return;
        if (root.hasAttribute('data-i18n-html') && typeof FH_ZH_HTML !== 'undefined') {
            const html = FH_ZH_HTML[root.getAttribute('data-i18n-html')];
            if (html) { root.innerHTML = html; root.removeAttribute('data-i18n-html'); }
        }
        const els = [root, ...root.querySelectorAll('*')];
        els.forEach(el => {
            if (el !== root && el.hasAttribute('data-i18n-html')) translateTree(el);
            I18N_ATTRS.forEach(a => {
                const v = el.getAttribute(a);
                if (v && d[v.trim()] != null) el.setAttribute(a, d[v.trim()]);
            });
        });
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: n => /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach(n => translateTree(n));
    }
    function startI18n() {
        document.addEventListener('click', e => {
            if (e.target.closest('[data-fh-lang]')) setLang(lang() === 'zh' ? 'en' : 'zh');
        });
        if (!zh()) return;
        document.documentElement.lang = 'zh-CN';
        document.title = t(document.title);
        translateTree(document.body);
        new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(translateTree)))
            .observe(document.body, { childList: true, subtree: true });
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function user() {
        try { return JSON.parse(read(USER_KEY)); } catch (e) { return null; }
    }
    function isAdmin() { const u = user(); return !!u && u.role === 'admin'; }

    function setSession(token, u) {
        save(TOKEN_KEY, token);
        save(USER_KEY, JSON.stringify(u));
    }
    function clearSession() {
        save(TOKEN_KEY, null);
        save(USER_KEY, null);
    }

    function goLogin(message) {
        const page = location.pathname.split('/').pop() || 'index.html';
        let url = 'login.html?next=' + encodeURIComponent(page);
        if (message) url += '&msg=' + encodeURIComponent(message);
        location.replace(url);
    }

    async function api(action, params = {}) {
        const body = new URLSearchParams();
        body.append('action', action);
        body.append('token', read(TOKEN_KEY) || '');
        Object.entries(params).forEach(([k, v]) => body.append(k, v == null ? '' : String(v)));

        let res;
        try {
            res = await fetch(FH_API_URL, { method: 'POST', body });
        } catch (e) {
            throw new Error(t('Could not reach the server. Check your internet connection and try again.'));
        }
        if (!res.ok) throw new Error(t('Server error (HTTP {status}).', { status: res.status }));

        let data;
        try { data = await res.json(); }
        catch (e) { throw new Error(t('The server sent an unexpected reply. Check that the latest Apps Script version is deployed.')); }

        if (data.status !== 'success') {
            const message = data.message ? tMsg(data.message) : t('Request failed.');
            if (data.code === 'AUTH' && action !== 'login') {
                clearSession();
                goLogin(message);
            }
            const err = new Error(message);
            err.code = data.code;
            throw err;
        }
        return data;
    }

    function renderNav(activePage) {
        const u = user();
        const el = document.getElementById('fhNav');
        if (!el || !u) return;
        const admin = u.role === 'admin';
        const links = [
            ['index.html', 'fa-warehouse', 'Stock'],
            ['update.html', 'fa-pen-to-square', 'Update'],
            ['history.html', 'fa-clock-rotate-left', 'History'],
            ['stats.html', 'fa-chart-column', 'Stats'],
            ['users.html', admin ? 'fa-users' : 'fa-user', admin ? 'Users' : 'Account']
        ];
        el.innerHTML = `<nav class="nav">
            <span class="nav-brand"><i class="fas fa-warehouse"></i> Firsthill</span>
            ${links.map(([href, icon, label]) =>
                `<a href="${href}" class="nav-link ${href === activePage ? 'active' : ''}"><i class="fas ${icon}"></i> ${label}</a>`
            ).join('')}
            <span class="nav-user"><i class="fas fa-circle-user"></i> ${esc(u.name || u.username)} <span class="role">${esc(u.role)}</span></span>
            ${langButtonHtml()}
            <button type="button" class="nav-link" id="fhLogout"><i class="fas fa-right-from-bracket"></i> Sign out</button>
        </nav>`;
        document.getElementById('fhLogout').addEventListener('click', async () => {
            try { await api('logout'); } catch (e) {}
            clearSession();
            location.replace('login.html');
        });
    }

    /** Call at the top of every protected page. Returns the user, or null (and redirects) if not signed in. */
    function requireLogin(activePage, opts = {}) {
        const u = user();
        if (!read(TOKEN_KEY) || !u) { goLogin(); return null; }
        if (opts.admin && u.role !== 'admin') { location.replace('index.html'); return null; }
        renderNav(activePage);
        return u;
    }

    // ---------- toast ----------
    function toast(msg, isError = false) {
        let t = document.getElementById('fhToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'fhToast';
            t.className = 'toast';
            t.setAttribute('role', 'status');
            document.body.appendChild(t);
        }
        t.innerHTML = `<i class="fas ${isError ? 'fa-circle-exclamation' : 'fa-circle-check'}" style="color:${isError ? '#ff5e5e' : '#7bffa0'}"></i>${esc(tMsg(msg))}`;
        t.classList.toggle('ok', !isError);
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 4000);
    }

    // ---------- dates ----------
    function toDate(v) {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    function fmtDate(v) {
        const d = toDate(v);
        return d ? d.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    }
    function fmtDateTime(v) {
        const d = toDate(v);
        return d ? d.toLocaleString(locale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(v ?? '');
    }
    function daysAgo(v) {
        const d = toDate(v);
        if (!d) return null;
        return Math.max(0, Math.floor((Date.now() - d.getTime()) / DAY));
    }
    function ageText(v) {
        const n = daysAgo(v);
        if (n == null) return '';
        if (n === 0) return t('today');
        if (n === 1) return t('yesterday');
        if (n < 60) return t('{n} days ago', { n });
        if (n < 730) return t('{n} months ago', { n: Math.round(n / 30) });
        return t('{n} years ago', { n: (n / 365).toFixed(1) });
    }

    // ---------- stock helpers ----------
    function keyOf(brand, size, store) {
        return [brand, size, store].map(s => String(s ?? '').trim()).join('|');
    }
    /** Low-stock level for an item. 0 means "don't alert for this tyre". */
    function levelOf(item, lowDefault) {
        return item.min != null ? item.min : lowDefault;
    }
    function statusOf(item, lowDefault) {
        const level = levelOf(item, lowDefault);
        if (level <= 0) return item.qty === 0 ? 'idle' : 'ok';
        if (item.qty === 0) return 'out';
        if (item.qty <= level) return 'low';
        return 'ok';
    }
    /** Timestamp of the oldest tyre on hand. Stock from before tracking started counts as oldest. */
    function oldestTs(item) {
        if (item.qty <= 0) return null;
        if (item.untracked > 0) return -1e15;
        const d = toDate(item.oldestIn);
        return d ? d.getTime() : -1e15;
    }
    /** Marks item.useFirst on the storeroom holding the oldest stock of each brand+size. */
    function markUseFirst(items) {
        const groups = {};
        items.forEach(i => {
            i.useFirst = false;
            if (i.qty > 0) (groups[keyOf(i.brand, i.size, '')] ||= []).push(i);
        });
        Object.values(groups).forEach(g => {
            if (g.length < 2) return;
            const sorted = g.slice().sort((a, b) => oldestTs(a) - oldestTs(b));
            if (oldestTs(sorted[0]) < oldestTs(sorted[1])) sorted[0].useFirst = true;
        });
    }
    function naturalSort(a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    // ---------- storerooms: shops vs warehouses ----------
    let storeTypes = {};          // name -> 'shop' | 'warehouse'
    let moveFirst = [];           // storerooms to suggest moving stock from first (e.g. A1)
    /** Call with the `stores` and `moveFromFirst` lists from getInventory. */
    function setStores(list, first) {
        storeTypes = {};
        (list || []).forEach(s => { storeTypes[s.name] = s.type; });
        if (first) moveFirst = first.map(x => String(x).toLowerCase());
    }
    function isShop(name) { return storeTypes[name] === 'shop'; }
    /** Known storerooms, warehouses first then shops, each A–Z. Pass extra names (e.g. from history) to include them. */
    function storeNames(extra = []) {
        const names = [...new Set(Object.keys(storeTypes).concat(extra))].filter(Boolean);
        return names.sort((a, b) => (isShop(a) - isShop(b)) || naturalSort(a, b));
    }
    function storeIcon(name) { return isShop(name) ? 'fa-store' : 'fa-warehouse'; }
    function storeTag(name) {
        return `<span class="wh-tag ${isShop(name) ? 'shop' : ''}"><i class="fas ${storeIcon(name)}" style="margin-right:4px;"></i>${esc(name)}</span>`;
    }
    /** <option>s grouped into Warehouses / Shops. */
    function storeOptions(names, selected, labelFn) {
        const opt = n => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(labelFn ? labelFn(n) : n)}</option>`;
        const wh = names.filter(n => !isShop(n)), sh = names.filter(isShop);
        if (!wh.length || !sh.length) return names.map(opt).join('');
        return `<optgroup label="Warehouses">${wh.map(opt).join('')}</optgroup><optgroup label="Shops">${sh.map(opt).join('')}</optgroup>`;
    }
    /** Order for "move stock from" suggestions: A1 (or whatever is set) first, then shops, then other warehouses. */
    function sourceRank(name) {
        const i = moveFirst.indexOf(String(name).toLowerCase());
        if (i !== -1) return i;
        return moveFirst.length + (isShop(name) ? 0 : 1);
    }

    return {
        api, esc, user, isAdmin, setSession, clearSession, requireLogin, toast,
        toDate, fmtDate, fmtDateTime, daysAgo, ageText,
        keyOf, levelOf, statusOf, oldestTs, markUseFirst, naturalSort, DAY,
        setStores, isShop, storeNames, storeIcon, storeTag, storeOptions, sourceRank,
        t, tp, tMsg, lang, locale, setLang, langButtonHtml, translateTree, startI18n
    };
})();

FH.startI18n();
