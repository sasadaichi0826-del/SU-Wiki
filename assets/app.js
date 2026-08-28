/* SU0911 Wiki — content rendering, navigation, search, theme. */
window.Wiki = (function () {
    'use strict';

    var content = null;
    var editing = false;
    var originals = [];

    var els = {
        sidebar: document.getElementById('sidebar'),
        sections: document.getElementById('sections'),
        hero: document.getElementById('hero'),
        toc: document.getElementById('toc-links'),
        search: document.getElementById('search'),
        noResults: document.getElementById('no-results'),
        qEcho: document.getElementById('q-echo')
    };

    var observer = null;

    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    /* ---------- Rendering ---------- */

    function renderHero() {
        var site = content.site;
        els.hero.innerHTML =
            '<div class="breadcrumb"><span>Wiki</span><span>›</span><span>攻略トップ</span></div>' +
            '<h1>' + esc(site.title) + '</h1>' +
            '<p>' + esc(site.tagline) + '</p>' +
            '<div class="hero-meta">' + (site.chips || []).map(function (c) {
                return '<span class="chip">' + esc(c) + '</span>';
            }).join('') + '</div>';
    }

    function renderSidebar() {
        var html = '';
        var lastGroup = null;

        content.pages.forEach(function (page) {
            var group = page.group || 'ページ';
            if (group !== lastGroup) {
                html += '<div class="group">' + esc(group) + '</div>';
                lastGroup = group;
            }
            html += '<a href="#' + esc(page.id) + '">' + esc(page.icon || '📄') + ' ' + esc(page.title) + '</a>';
        });

        els.sidebar.innerHTML = html;
    }

    function renderSections() {
        els.sections.innerHTML = content.pages.map(function (page) {
            return '<section class="doc" id="' + esc(page.id) + '" data-page-id="' + esc(page.id) + '">' +
                '<h2>' + esc(page.icon || '📄') + ' ' + esc(page.title) +
                ' <a class="anchor" href="#' + esc(page.id) + '" aria-label="このセクションへのリンク">#</a></h2>' +
                '<div class="doc-body">' + page.html + '</div>' +
                '</section>';
        }).join('');
    }

    function renderToc() {
        els.toc.innerHTML = content.pages.map(function (page) {
            return '<a href="#' + esc(page.id) + '">' + esc(page.icon || '📄') + ' ' + esc(page.title) + '</a>';
        }).join('');
    }

    function sections() {
        return Array.prototype.slice.call(els.sections.querySelectorAll('section.doc'));
    }

    function navLinks() {
        return Array.prototype.slice.call(els.sidebar.querySelectorAll('a'))
            .concat(Array.prototype.slice.call(els.toc.querySelectorAll('a')));
    }

    function setupScrollSpy() {
        if (observer) observer.disconnect();

        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var hash = '#' + entry.target.id;
                navLinks().forEach(function (a) {
                    a.classList.toggle('active', a.getAttribute('href') === hash);
                });
            });
        }, { rootMargin: '-70px 0px -65% 0px', threshold: 0 });

        sections().forEach(function (s) { observer.observe(s); });
    }

    function render() {
        renderHero();
        renderSidebar();
        renderSections();
        renderToc();
        setupScrollSpy();
        snapshot();
        bindNavClose();
    }

    /* ---------- Search ---------- */

    function snapshot() {
        originals = sections().map(function (s) { return s.innerHTML; });
    }

    function restore() {
        sections().forEach(function (s, i) {
            if (typeof originals[i] === 'string' && s.innerHTML !== originals[i]) s.innerHTML = originals[i];
        });
    }

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function highlight(node, re) {
        Array.prototype.slice.call(node.childNodes).forEach(function (child) {
            if (child.nodeType === 3) {
                var text = child.nodeValue;
                re.lastIndex = 0;
                if (!re.test(text)) return;
                re.lastIndex = 0;
                var span = document.createElement('span');
                span.innerHTML = text.replace(/[&<>]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
                }).replace(re, '<mark>$&</mark>');
                child.parentNode.replaceChild(span, child);
            } else if (child.nodeType === 1 && child.tagName !== 'MARK') {
                highlight(child, re);
            }
        });
    }

    function runSearch() {
        if (editing) return;

        var q = els.search.value.trim();
        restore();
        document.body.classList.toggle('searching', q.length > 0);

        var secs = sections();
        var sideLinks = Array.prototype.slice.call(els.sidebar.querySelectorAll('a'));

        if (!q) {
            secs.forEach(function (s) { s.classList.remove('hidden-by-search'); });
            sideLinks.forEach(function (a) { a.classList.remove('hidden-by-search'); });
            els.noResults.style.display = 'none';
            return;
        }

        var re = new RegExp(escapeRe(q), 'gi');
        var hits = 0;

        secs.forEach(function (sec) {
            var match = sec.textContent.toLowerCase().indexOf(q.toLowerCase()) !== -1;
            sec.classList.toggle('hidden-by-search', !match);
            if (match) {
                hits++;
                highlight(sec, re);
            }
        });

        sideLinks.forEach(function (a) {
            var sec = document.getElementById(a.getAttribute('href').slice(1));
            a.classList.toggle('hidden-by-search', !!sec && sec.classList.contains('hidden-by-search'));
        });

        els.qEcho.textContent = q;
        els.noResults.style.display = hits ? 'none' : 'block';
    }

    function clearSearch() {
        els.search.value = '';
        runSearch();
    }

    els.search.addEventListener('input', runSearch);

    els.search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { clearSearch(); els.search.blur(); }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement !== els.search && !editing) {
            e.preventDefault();
            els.search.focus();
        }
    });

    /* ---------- Mobile nav / theme / back-to-top ---------- */

    var menuBtn = document.getElementById('menu-btn');
    var scrim = document.getElementById('scrim');

    function closeNav() {
        document.body.classList.remove('nav-open');
        menuBtn.setAttribute('aria-expanded', 'false');
    }

    menuBtn.addEventListener('click', function () {
        var open = document.body.classList.toggle('nav-open');
        menuBtn.setAttribute('aria-expanded', String(open));
    });

    scrim.addEventListener('click', closeNav);

    function bindNavClose() {
        Array.prototype.slice.call(els.sidebar.querySelectorAll('a')).forEach(function (a) {
            a.addEventListener('click', closeNav);
        });
    }

    var themeBtn = document.getElementById('theme-btn');
    var stored = null;
    try { stored = localStorage.getItem('su-wiki-theme'); } catch (err) { stored = null; }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
        try { localStorage.setItem('su-wiki-theme', theme); } catch (err) { /* ignore */ }
    }

    applyTheme(stored === 'light' ? 'light' : 'dark');

    themeBtn.addEventListener('click', function () {
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    var toTop = document.getElementById('to-top');

    window.addEventListener('scroll', function () {
        toTop.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });

    toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* ---------- Boot ---------- */

    var ready = fetch('content.json', { cache: 'no-store' })
        .then(function (res) {
            if (!res.ok) throw new Error('content.json ' + res.status);
            return res.json();
        })
        .then(function (data) {
            content = data;
            render();
            if (location.hash) {
                var target = document.getElementById(location.hash.slice(1));
                if (target) target.scrollIntoView();
            }
            return content;
        })
        .catch(function (err) {
            els.sections.innerHTML = '<section class="doc"><h2>読み込みエラー</h2>' +
                '<p>コンテンツを読み込めませんでした（' + esc(err.message) + '）。</p></section>';
            throw err;
        });

    return {
        ready: ready,
        get content() { return content; },
        get editing() { return editing; },
        setEditing: function (on) {
            editing = on;
            document.body.classList.toggle('editing', on);
            if (on) clearSearch();
        },
        render: render,
        snapshot: snapshot,
        clearSearch: clearSearch,
        setupScrollSpy: setupScrollSpy,
        esc: esc
    };
})();
