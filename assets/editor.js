/* SU0911 Wiki — in-page WYSIWYG editing that commits content.json to GitHub. */
(function () {
    'use strict';

    var REPO = { owner: 'sasadaichi0826-del', name: 'SU-Wiki', branch: 'main', path: 'content.json' };

    /* On a <owner>.github.io/<repo>/ deploy, derive the repo from the URL so forks work too. */
    (function detectRepo() {
        var host = location.hostname.match(/^([\w-]+)\.github\.io$/);
        var seg = location.pathname.split('/').filter(Boolean)[0];
        if (host) REPO.owner = host[1];
        if (host && seg && !/\.html?$/.test(seg)) REPO.name = seg;
    })();

    var TOKEN_KEY = 'su-wiki-token';
    var API = 'https://api.github.com';

    var editBtn = document.getElementById('edit-btn');
    var editBar = document.getElementById('edit-bar');
    var editState = document.getElementById('edit-state');
    var saveBtn = document.getElementById('save-btn');
    var cancelBtn = document.getElementById('cancel-btn');
    var addPageBtn = document.getElementById('add-page');
    var sectionsBox = document.getElementById('sections');

    var user = null;
    var fileSha = null;
    var toolbarEl = null;

    function token() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }

    function setToken(value) {
        try {
            if (value) localStorage.setItem(TOKEN_KEY, value);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* ignore */ }
    }

    function api(path, options) {
        options = options || {};
        options.headers = Object.assign({
            'Accept': 'application/vnd.github+json',
            'Authorization': 'Bearer ' + token()
        }, options.headers || {});
        return fetch(API + path, options);
    }

    function toast(message, kind) {
        var el = document.createElement('div');
        el.className = 'toast ' + (kind || '');
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, kind === 'err' ? 8000 : 4500);
    }

    /* ---------- Login modal ---------- */

    function tokenUrl() {
        return 'https://github.com/settings/personal-access-tokens/new';
    }

    function openLogin() {
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML =
            '<div class="modal">' +
            '<h2>編集するにはGitHubの許可キーが必要です</h2>' +
            '<p>このWikiは編集内容をGitHubに保存します。1回だけキーを登録すれば、次からはボタンひとつで編集できます。</p>' +
            '<ol>' +
            '<li><a href="' + tokenUrl() + '" target="_blank" rel="noopener">GitHubのキー発行ページ</a>を開く</li>' +
            '<li>Repository access で <b>' + REPO.owner + '/' + REPO.name + '</b> を選ぶ</li>' +
            '<li>Permissions → Repository permissions → <b>Contents</b> を <b>Read and write</b> にする</li>' +
            '<li>作成されたキー（ghp_… / github_pat_…）を下に貼り付ける</li>' +
            '</ol>' +
            '<label>キー<input type="password" id="token-input" placeholder="github_pat_..." autocomplete="off"></label>' +
            '<div class="error" id="login-error"></div>' +
            '<div class="row">' +
            '<button class="btn ghost" id="login-cancel">やめる</button>' +
            '<button class="btn primary" id="login-ok">ログイン</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(backdrop);

        var input = backdrop.querySelector('#token-input');
        var error = backdrop.querySelector('#login-error');
        var ok = backdrop.querySelector('#login-ok');

        input.focus();

        function close() { backdrop.remove(); }

        backdrop.querySelector('#login-cancel').addEventListener('click', close);

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') ok.click();
        });

        ok.addEventListener('click', function () {
            var value = input.value.trim();
            if (!value) { error.textContent = 'キーを貼り付けてください。'; return; }

            ok.disabled = true;
            error.textContent = '確認中…';
            setToken(value);

            verify().then(function () {
                close();
                startEditing();
            }).catch(function (err) {
                setToken('');
                ok.disabled = false;
                error.textContent = err.message;
            });
        });
    }

    function verify() {
        return api('/user').then(function (res) {
            if (!res.ok) throw new Error('キーが無効です（' + res.status + '）。発行し直して貼り直してください。');
            return res.json();
        }).then(function (data) {
            user = data;
            return api('/repos/' + REPO.owner + '/' + REPO.name);
        }).then(function (res) {
            if (!res.ok) throw new Error('リポジトリにアクセスできません。キーの Repository access を確認してください。');
            return res.json();
        }).then(function (repo) {
            if (!repo.permissions || !repo.permissions.push) {
                throw new Error('このキーには書き込み権限がありません。Contents を Read and write にしてください。');
            }
            return user;
        });
    }

    /* ---------- HTML cleanup ---------- */

    var ALLOWED = ['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN',
        'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'CODE', 'MARK'];

    function clean(root) {
        Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function (el) {
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'IFRAME') {
                el.remove();
                return;
            }

            Array.prototype.slice.call(el.attributes).forEach(function (attr) {
                var name = attr.name.toLowerCase();
                var keep = name === 'class' || (el.tagName === 'A' && (name === 'href' || name === 'target' || name === 'rel'));
                if (!keep) el.removeAttribute(attr.name);
            });

            if (ALLOWED.indexOf(el.tagName) === -1) {
                el.replaceWith.apply(el, Array.prototype.slice.call(el.childNodes));
            }
        });

        return root.innerHTML.trim();
    }

    function slugify(title, taken) {
        var base = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!base) base = 'page';
        var id = base;
        var n = 2;
        while (taken.indexOf(id) !== -1) { id = base + '-' + n; n++; }
        return id;
    }

    /* ---------- Toolbar ---------- */

    var TOOLS = [
        { label: '太字', title: '太字', run: function () { document.execCommand('bold'); } },
        { label: '見出し', title: '見出し（中見出し）', run: function () { document.execCommand('formatBlock', false, 'h3'); } },
        { label: '本文', title: 'ふつうの文章に戻す', run: function () { document.execCommand('formatBlock', false, 'p'); } },
        { sep: true },
        { label: '• リスト', title: '箇条書き', run: function () { document.execCommand('insertUnorderedList'); } },
        { label: '1. リスト', title: '番号付きリスト', run: function () { document.execCommand('insertOrderedList'); } },
        { label: '🔗 リンク', title: 'リンクを挿入', run: insertLink },
        { sep: true },
        { label: '⬜ カード', title: 'カード枠を挿入', run: function () { insertBlock('card'); } },
        { label: '💡 ヒント', title: 'ヒント枠を挿入', run: function () { insertBlock('note'); } },
        { label: '⚠ 注意', title: '注意枠を挿入', run: function () { insertBlock('note warning'); } },
        { label: '📊 表', title: '表を挿入', run: insertTable },
        { sep: true },
        { label: '↩ 取り消し', title: '元に戻す', run: function () { document.execCommand('undo'); } }
    ];

    function insertHtml(html) {
        document.execCommand('insertHTML', false, html);
    }

    function insertLink() {
        var url = prompt('リンク先のURLを入力してください', 'https://');
        if (!url) return;
        document.execCommand('createLink', false, url);
    }

    function insertBlock(kind) {
        if (kind === 'card') {
            insertHtml('<div class="card"><h3>見出し</h3><p>ここに文章を書く</p></div><p><br></p>');
        } else {
            var label = kind.indexOf('warning') !== -1 ? '⚠ 注意' : 'ポイント';
            insertHtml('<div class="' + kind + '"><span class="label">' + label + '</span>ここに文章を書く</div><p><br></p>');
        }
    }

    function insertTable() {
        var cols = parseInt(prompt('列の数', '3'), 10);
        var rows = parseInt(prompt('データ行の数（見出し行を除く）', '3'), 10);
        if (!cols || !rows || cols < 1 || rows < 1) return;

        var head = '<tr>' + Array(cols + 1).join('<th>見出し</th>') + '</tr>';
        var body = Array(rows + 1).join('<tr>' + Array(cols + 1).join('<td>内容</td>') + '</tr>');
        insertHtml('<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div><p><br></p>');
    }

    function buildToolbar() {
        var bar = document.createElement('div');
        bar.className = 'toolbar';

        TOOLS.forEach(function (tool) {
            if (tool.sep) {
                var sep = document.createElement('span');
                sep.className = 'sep';
                bar.appendChild(sep);
                return;
            }

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = tool.label;
            btn.title = tool.title;
            btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
            btn.addEventListener('click', function () { tool.run(); });
            bar.appendChild(btn);
        });

        return bar;
    }

    /* ---------- Edit mode ---------- */

    function groupOptions(selected) {
        var groups = [];
        Wiki.content.pages.forEach(function (p) {
            var g = p.group || 'ページ';
            if (groups.indexOf(g) === -1) groups.push(g);
        });
        if (groups.indexOf(selected) === -1) groups.push(selected);

        return groups.map(function (g) {
            return '<option value="' + Wiki.esc(g) + '"' + (g === selected ? ' selected' : '') + '>' + Wiki.esc(g) + '</option>';
        }).join('');
    }

    function decorateSection(section, page) {
        var head = document.createElement('div');
        head.className = 'doc-head-edit';
        head.innerHTML =
            '<input class="icon-input" value="' + Wiki.esc(page.icon || '📄') + '" aria-label="アイコン">' +
            '<input class="title-input" value="' + Wiki.esc(page.title) + '" aria-label="ページ名">' +
            '<select class="group-select" aria-label="カテゴリ">' + groupOptions(page.group || 'ページ') + '</select>' +
            '<button class="btn small danger delete-page" type="button">このページを削除</button>';

        var h2 = section.querySelector('h2');
        section.replaceChild(head, h2);

        var body = section.querySelector('.doc-body');
        body.setAttribute('contenteditable', 'true');
        body.classList.add('body-edit');

        head.querySelector('.delete-page').addEventListener('click', function () {
            if (!confirm('「' + page.title + '」を削除しますか？')) return;
            section.remove();
        });

        body.addEventListener('focus', function () {
            if (toolbarEl) toolbarEl.remove();
            toolbarEl = buildToolbar();
            section.insertBefore(toolbarEl, body);
        });

        body.addEventListener('paste', function (e) {
            e.preventDefault();
            var text = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });
    }

    function startEditing() {
        Wiki.setEditing(true);
        editBar.classList.remove('hidden');
        addPageBtn.classList.remove('hidden');
        editBtn.classList.add('hidden');
        editState.innerHTML = '<b>' + Wiki.esc(user.login) + '</b> として編集中 — 保存するとGitHubにコミットされ、1〜2分で公開ページに反映されます。';

        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* ignore */ }
        try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }

        Array.prototype.slice.call(sectionsBox.querySelectorAll('section.doc')).forEach(function (section) {
            var page = Wiki.content.pages.filter(function (p) { return p.id === section.dataset.pageId; })[0];
            if (page) decorateSection(section, page);
        });
    }

    function stopEditing() {
        if (toolbarEl) { toolbarEl.remove(); toolbarEl = null; }
        Wiki.setEditing(false);
        editBar.classList.add('hidden');
        addPageBtn.classList.add('hidden');
        editBtn.classList.remove('hidden');
        Wiki.render();
    }

    addPageBtn.addEventListener('click', function () {
        var title = prompt('新しいページの名前');
        if (!title) return;

        var taken = Array.prototype.slice.call(sectionsBox.querySelectorAll('section.doc')).map(function (s) {
            return s.dataset.pageId;
        });

        var page = {
            id: slugify(title, taken),
            icon: '📄',
            title: title,
            group: (Wiki.content.pages[Wiki.content.pages.length - 1] || {}).group || 'ページ',
            html: '<p>ここに内容を書く</p>'
        };

        var section = document.createElement('section');
        section.className = 'doc';
        section.id = page.id;
        section.dataset.pageId = page.id;
        section.innerHTML = '<h2>' + Wiki.esc(page.icon) + ' ' + Wiki.esc(page.title) + '</h2>' +
            '<div class="doc-body">' + page.html + '</div>';

        sectionsBox.appendChild(section);
        decorateSection(section, page);
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    function collect() {
        return Array.prototype.slice.call(sectionsBox.querySelectorAll('section.doc')).map(function (section) {
            var head = section.querySelector('.doc-head-edit');
            var body = section.querySelector('.doc-body');
            var title = head.querySelector('.title-input').value.trim() || '無題';
            var copy = document.createElement('div');
            copy.innerHTML = body.innerHTML;

            return {
                id: section.dataset.pageId,
                icon: head.querySelector('.icon-input').value.trim() || '📄',
                title: title,
                group: head.querySelector('.group-select').value,
                html: clean(copy)
            };
        });
    }

    function encodeUtf8(text) {
        var bytes = new TextEncoder().encode(text);
        var binary = '';
        bytes.forEach(function (b) { binary += String.fromCharCode(b); });
        return btoa(binary);
    }

    function loadSha() {
        return api('/repos/' + REPO.owner + '/' + REPO.name + '/contents/' + REPO.path + '?ref=' + REPO.branch)
            .then(function (res) {
                if (!res.ok) throw new Error('content.json を取得できませんでした（' + res.status + '）。');
                return res.json();
            })
            .then(function (data) { fileSha = data.sha; return fileSha; });
    }

    saveBtn.addEventListener('click', function () {
        var pages = collect();
        if (!pages.length) { toast('ページが1つもありません。', 'err'); return; }

        var next = { site: Wiki.content.site, pages: pages };
        var body = JSON.stringify(next, null, 2) + '\n';

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';

        loadSha().then(function (sha) {
            return api('/repos/' + REPO.owner + '/' + REPO.name + '/contents/' + REPO.path, {
                method: 'PUT',
                body: JSON.stringify({
                    message: 'Update wiki content via in-page editor',
                    content: encodeUtf8(body),
                    sha: sha,
                    branch: REPO.branch
                })
            });
        }).then(function (res) {
            if (res.status === 409) throw new Error('他の人の編集と競合しました。ページを再読み込みしてからやり直してください。');
            if (!res.ok) return res.json().then(function (data) {
                throw new Error(data.message || ('保存に失敗しました（' + res.status + '）。'));
            });
            return res.json();
        }).then(function () {
            Wiki.content.pages = pages;
            stopEditing();
            toast('保存しました。1〜2分で公開ページに反映されます。', 'ok');
        }).catch(function (err) {
            toast(err.message, 'err');
        }).then(function () {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 保存して公開';
        });
    });

    cancelBtn.addEventListener('click', function () {
        if (!confirm('編集内容を破棄しますか？')) return;
        stopEditing();
    });

    editBtn.addEventListener('click', function () {
        if (!Wiki.content) { toast('コンテンツの読み込みが終わっていません。', 'err'); return; }

        if (!token()) { openLogin(); return; }

        editBtn.disabled = true;
        verify().then(function () {
            startEditing();
        }).catch(function (err) {
            setToken('');
            toast(err.message, 'err');
            openLogin();
        }).then(function () {
            editBtn.disabled = false;
        });
    });

    window.addEventListener('beforeunload', function (e) {
        if (!Wiki.editing) return;
        e.preventDefault();
        e.returnValue = '';
    });
})();
