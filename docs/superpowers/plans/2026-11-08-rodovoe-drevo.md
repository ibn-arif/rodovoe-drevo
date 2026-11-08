# Родовое древо — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статический сайт на GitHub Pages, где любой создаёт родовое древо, родня правит его по ссылке через черновик и «Сохранить», создатель откатывает правки, а плакат скачивается в PDF в четырёх дизайнах.

**Architecture:** Чистые HTML/CSS/ES-модули без сборки. Вся логика прав и данных — в функциях Postgres в Supabase (`security definer`, таблицы закрыты RLS); браузер зовёт только RPC через supabase-js. Черновик правок — список операций в `localStorage`; «Сохранить» отправляет их одним атомарным вызовом. PDF строится в браузере: SVG-раскладка → jsPDF + svg2pdf.js со встроенным PT Serif.

**Tech Stack:** HTML/CSS/JS (ES-модули), d3 7.8.5, supabase-js 2 (CDN, точная версия), jsPDF + svg2pdf.js (в `vendor/`), Postgres (Supabase). Тесты: `node:test` для чистой логики, `@electric-sql/pglite` для SQL, `@playwright/test` для страниц.

**Spec:** `docs/superpowers/specs/2026-11-08-rodovoe-drevo-design.md`

## Global Constraints

- В репозитории, коде, тестах, комментариях и текстах интерфейса — **ни фамилии рода владельца, ни имён из его семьи**. Тестовые имена — вымышленные (Магомед, Али, Патимат, Асият…) или Романовы. Всё про семейное древо — только в `private/` (в `.gitignore`).
- Буква `Ӏ` (U+04C0) везде, где пишется имя; поиск приравнивает к ней `I`, `l`, `1`, `ӏ`, а `ё` к `е`.
- Интерфейс по-русски.
- Без сборки: файлы отдаются GitHub Pages как есть. `node_modules` только для тестов.
- d3 **7.8.5** и шрифты PT Serif — из `<исходный проект>/vendor/` (копировать файлы, не пути). supabase-js — с `cdn.jsdelivr.net/npm/@supabase/supabase-js@<точная версия 2.x>`.
- Размеры плаката: A0 841×1189, A1 594×841, A2 420×594, A3 297×420, A4 210×297 мм.
- Дизайны плаката: `classic` «Классика», `topdown` «Сверху вниз», `fan` «Круг», `gold` «Тёмный с золотом».
- Права: `owner` — всё; `edit` — добавлять, исправлять, переносить, браки, **удалять**, видеть историю, без отката; `view` — смотреть, искать, плакат.
- Сайт сначала под телефон: проверять на ширине **390** и **1280**.
- Таблицы закрыты для `anon` и `authenticated`; доступ только через функции.

## Review Focus

1. **Черновик ссылается на человека, которого другой уже удалил или перенёс** (родственник добавил ребёнка к Али, а кто-то сохранил удаление ветки Али). Ожидание: сохранение не создаёт сироту, а возвращает конфликт с этим человеком. → Task 2, тест `ops on deleted person conflict`.
2. **Пустое или огромное имя** («   », 500 символов, перевод строки). Ожидание: имя обрезается по краям, пустое отклоняется понятной ошибкой, длиннее 100 символов — отклоняется. → Task 2, тест `name validation`; Task 4, тест `validateName`.
3. **Большое древо на маленьком листе** (400 человек, «Круг» на A4). Ожидание: раскладка не падает и каждое имя есть в SVG. → Task 9, тест `layouts render 400 people`.
4. **`localStorage` недоступен** (приватный режим, Safari). Ожидание: черновик работает в памяти, сайт показывает «Изменения не переживут закрытие вкладки». → Task 5, тест `draft without storage`.
5. **Неверная или обрезанная ссылка** (WhatsApp обрезал хвост токена). Ожидание: страница «Древо не найдено. Проверьте ссылку целиком», а не пустой экран. → Task 7, тест `unknown token`.

---

## Файлы

```
index.html                  главная: создание древа, ссылка на пример
tree.html                   страница древа (токен в #t=...)
css/site.css                токены цвета (свет/тьма), общие стили
js/config.js                SUPABASE_URL, SUPABASE_ANON_KEY, BASE_URL
js/api.js                   обёртка RPC; window.__TEST_API__ подменяет в тестах
js/tokens.js                генерация и вывод токенов, хэш
js/model.js                 строки → дерево; применение операций; описание операций по-русски
js/names.js                 нормализация для поиска, проверка имени
js/draft.js                 черновик: список операций + хранилище
js/create.js                логика главной
js/tree-page.js             сборка страницы древа (загрузка, опрос версии, роли)
js/tree-view.js             d3-отрисовка древа
js/panel.js                 панель человека
js/draft-bar.js             полоска черновика, список, сохранение, конфликты
js/history.js               экран истории и отката
js/share.js                 «Пригласить родных»
js/poster/layouts.js        четыре раскладки → SVG
js/poster/pdf.js            SVG → PDF
js/poster/dialog.js         окно «Плакат PDF»
vendor/                     d3.min.js, jspdf.umd.min.js, svg2pdf.umd.min.js, fonts/*.woff2, fonts/*.ttf
supabase/schema.sql         таблицы, RLS, функции
supabase/example.sql        сгенерированный пример (Романовы)
data/romanov.json           данные примера
scripts/apply-sql.mjs       применяет SQL к Supabase по SUPABASE_DB_URL
scripts/build-example.mjs   data/romanov.json → supabase/example.sql
tests/sql/*.test.mjs        PGlite
tests/unit/*.test.mjs       node:test
tests/e2e/*.spec.mjs        Playwright; tests/e2e/fake-api.js — API в памяти
.github/workflows/keepalive.yml
private/                    перенос семейного древа (не в git)
```

## Общие интерфейсы

**Операция черновика** (`op`) — объект JSON, одинаковый в браузере и в SQL:

| `type` | поля | смысл |
|---|---|---|
| `add_child` | `id` (uuid, создаёт клиент), `parent_id`, `name`, `spouse` | новый ребёнок в конец списка детей |
| `add_parent` | `id`, `child_id`, `name`, `spouse` | только если `child_id` — текущий корень; новый человек становится корнем |
| `update` | `person_id`, `name?`, `spouse?` | поправить имя и/или подпись о супруге |
| `move` | `person_id`, `parent_id` | перенести к другому родителю (не в собственную ветку, не корень) |
| `delete` | `person_id` | мягко удалить человека и всю ветку под ним (не корень) |
| `marry` | `id`, `a_id`, `b_id` | брак двух людей древа |
| `unmarry` | `marriage_id` | убрать брак |

**Снимок древа** (ответ `open_tree`): `{tree_id, title, role, root_id, version, is_example, people:[{id,parent_id,pos,name,spouse,updated_by,updated_at}], marriages:[{id,a_id,b_id}]}` — только неудалённые.

**Токены:** 22 символа base64url (16 случайных байт). `edit = derive(owner,'edit')`, `view = derive(owner,'view')`, где `derive(t, s) = base64url(sha256(t + ':' + s)).slice(0, 22)`. В базе — `encode(sha256(convert_to(token,'UTF8')),'hex')`. Создатель всегда может вычислить две другие ссылки из своей.

**Ссылки:** `${BASE_URL}tree.html#t=<token>`.

---

### Task 1: Каркас, схема базы, создание и открытие древа

**Files:**
- Create: `package.json`, `vendor/*` (скопировать d3 и woff2 из `<исходный проект>/vendor/`), `supabase/schema.sql`, `tests/sql/helpers.mjs`, `tests/sql/tree.test.mjs`
- Modify: `.gitignore` (+ `node_modules/`, `test-results/`, `playwright-report/`)

**Interfaces:**
- Produces (SQL, все `security definer`, `set search_path = public`, `grant execute ... to anon`):
  - `create_tree(p_title text, p_root_name text, p_owner_hash text, p_edit_hash text, p_view_hash text) returns jsonb` → `{tree_id, root_id}`
  - `open_tree(p_token text) returns jsonb` → снимок древа; неизвестный токен → `raise exception 'tree_not_found'`
  - `tree_version(p_token text) returns bigint`
  - `ping() returns int` → 1
  - внутренняя `_role(p_token text, out tree_id uuid, out role text)`
- Produces (JS): `tests/sql/helpers.mjs` → `async function freshDb(): Promise<PGlite>` (создаёт роли `anon`, `authenticated`, применяет `schema.sql`), `async function asAnon(db, sql, params)`.

- [ ] **Step 1:** `package.json`: `"type": "module"`, devDependencies `@electric-sql/pglite`, `@playwright/test`, `postgres`; scripts `test:unit` = `node --test tests/unit`, `test:sql` = `node --test tests/sql`, `test:e2e` = `playwright test`, `test` = все три. `npm install`.
- [ ] **Step 2: Тесты** в `tests/sql/tree.test.mjs`:
  - `create and open`: `create_tree('Род Магомеда','Магомед', h(o), h(e), h(v))`; `open_tree(o).role === 'owner'`, `open_tree(e).role === 'edit'`, `open_tree(v).role === 'view'`; `people.length === 1`, `people[0].name === 'Магомед'`, `version === 0`.
  - `unknown token`: `open_tree('нет-такого')` бросает `tree_not_found`.
  - `tables closed`: `asAnon(db, 'select * from people')` бросает permission denied; `asAnon(db, "select open_tree($1)", [o])` работает.
  - `rate limit`: с `set_config('request.headers','{"x-forwarded-for":"1.2.3.4"}',true)` шестой `create_tree` за час бросает `too_many_trees`; с другого адреса — проходит.
  - `root name validation`: `create_tree('Род','   ',…)` бросает `bad_name`.
- [ ] **Step 3:** `npm run test:sql` — FAIL (нет схемы).
- [ ] **Step 4:** `supabase/schema.sql`. Таблицы: `trees(id uuid pk, title, root_id uuid, owner_hash, edit_hash, view_hash unique каждый, version bigint default 0, is_example bool default false, created_at)`, `people(id uuid pk, tree_id, parent_id null, pos int, name text, spouse text default '', deleted_by bigint null, updated_by text, updated_at)`, `marriages(id uuid pk, tree_id, a_id, b_id, deleted_by bigint null)`, `saves(id bigserial pk, tree_id, author text, created_at, reverts_save bigint null, reverts_edit bigint null)`, `edits(id bigserial pk, save_id, op jsonb, before jsonb, after jsonb, people uuid[])`, `tree_creations(ip text, at timestamptz)`. RLS включён на всех, политик нет; `revoke all on all tables in schema public from anon, authenticated`. Лимит: 5 древ в час с одного IP (первый адрес из `x-forwarded-for`, без заголовка — `'local'`), 300 в сутки всего. Имя: `trim`, пусто → `bad_name`, длиннее 100 → `bad_name`. Файл идемпотентный (`create ... if not exists`, `create or replace function`).
- [ ] **Step 5:** `npm run test:sql` — PASS.
- [ ] **Step 6:** Commit `база: схема, создание и открытие древа`.

### Task 2: Сохранение черновика

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/sql/save.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`_role`, таблицы).
- Produces: `save_changes(p_token text, p_author text, p_base_version bigint, p_ops jsonb, p_force boolean default false) returns jsonb` →
  успех `{ok:true, save_id, version}`; конфликт `{ok:false, conflicts:[{person_id, name, by, at, reason}]}` где `reason` ∈ `'changed'|'deleted'`; ошибки — `raise exception` с кодами `forbidden`, `bad_name`, `bad_op`, `cycle`, `root_protected`, `not_root`.

- [ ] **Step 1: Тесты:**
  - `view cannot save`: с токеном просмотра → `forbidden`.
  - `batch applies atomically`: ops `[add_child Али к Магомеду, add_child Расул к Али, update Магомед spouse 'жена Асият', marry Али—Патимат]` → `ok`, `version === 1`, в `open_tree` 4 человека; если последняя op ссылается на несуществующего человека — `bad_op` и в базе ничего не изменилось (`version` 0, 1 человек).
  - `delete branch`: удалить Али → в `open_tree` нет Али и Расула; `deleted_by` у обоих одинаковый id правки.
  - `root_protected`: `delete` и `move` корня → `root_protected`.
  - `cycle`: `move` Али под Расула → `cycle`.
  - `add_parent`: к корню — новый человек становится `root_id`, старый корень — его ребёнок; к не-корню → `not_root`.
  - `conflict changed`: A и B открыли версию 1; B сохранил `update` Али; A сохраняет `update` Али с `base_version=1` → `ok:false`, `conflicts[0].reason==='changed'`, `by` = имя B; с `p_force=true` — `ok`.
  - `ops on deleted person conflict` (Review Focus 1): B удалил Али; A с `base_version=1` добавляет ребёнка к Али → `ok:false`, `reason==='deleted'`; с `p_force=true` → `bad_op` (сироту не создаём).
  - `name validation` (Review Focus 2): `add_child` с именем `'  Али  '` сохраняет `'Али'`; `'   '`, `'a'.repeat(101)`, `'Али\nРасул'` → `bad_name`.
  - `author recorded`: `people.updated_by` = автор; пустой автор → `bad_name`.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3:** реализовать. Конфликт: люди, затронутые операциями черновика (и их родители для `add_child`/`move`), которых меняли сохранения с `id` новее `p_base_version` этого древа (через `edits.people`), либо удалены. Каждая op пишется в `edits` с `before`/`after` (снимок строк до и после) и `people`. `version` древа = число сохранений.
- [ ] **Step 4:** PASS. **Step 5:** Commit `база: сохранение черновика`.

### Task 3: История и откат

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/sql/history.test.mjs`

**Interfaces:**
- Produces:
  - `get_history(p_token text, p_limit int default 50, p_before bigint default null) returns jsonb` → `[{save_id, author, at, reverts_save, reverts_edit, reverted_by, edits:[{edit_id, op, before, after}]}]`, новые сверху; `view` → `forbidden`.
  - `revert(p_token text, p_author text, p_save_id bigint, p_edit_id bigint default null) returns jsonb` → `{ok:true, save_id, version, warnings:[{person_id, name, by, at}]}`; не `owner` → `forbidden`; уже откачено → `already_reverted`.
  - `deleted_items(p_token text) returns jsonb` → `[{edit_id, save_id, person_id, name, count, by, at}]` — удаления, ещё не откаченные (только `owner`).

- [ ] **Step 1: Тесты:**
  - `edit cannot revert`: `revert` с токеном родни → `forbidden`; `get_history` с ним работает.
  - `revert delete restores branch`: удалить ветку Али (2 человека) → `deleted_items` даёт `count===2` → `revert(save, edit)` → Али и Расул снова в `open_tree`, у Расула прежний родитель; `deleted_items` пуст.
  - `revert whole save`: сохранение из 3 операций откатывается целиком в обратном порядке; древо совпадает с состоянием до него.
  - `revert single edit`: из того же сохранения откатить только `update` — остальные две операции остаются.
  - `revert add_parent`: корень снова прежний, добавленный предок удалён.
  - `warnings`: после сохранения S1 (update Али) и S2 (update Али) откат S1 → `ok`, в `warnings` есть Али с автором S2.
  - `revert is history`: откат — новая запись в `get_history` с `reverts_save`; у исходной — `reverted_by`.
  - `already_reverted`: повторный откат того же → ошибка.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать: обратная операция строится из `before`/`after` в `edits` (для `delete` — снять `deleted_by` у людей с этим id правки; для `add_*` — пометить добавленного удалённым и вернуть `root_id`; для `update`/`move` — вернуть поля из `before`; для `marry`/`unmarry` — наоборот). **Step 4:** PASS. **Step 5:** Commit `база: история и откат`.

### Task 4: Модель древа и имена (чистый JS)

**Files:**
- Create: `js/names.js`, `js/model.js`
- Test: `tests/unit/names.test.mjs`, `tests/unit/model.test.mjs`

**Interfaces:**
- Produces:
  - `names.js`: `norm(s: string): string` (нижний регистр, `[ӀӏIl1]→ӏ`, `ё→е`); `validateName(s: string): {ok: boolean, value?: string, error?: string}` — те же правила, что в SQL (trim, 1..100, без переводов строки); тексты ошибок: `'Введите имя'`, `'Слишком длинное имя'`, `'Имя в одну строку'`.
  - `model.js`:
    - `buildTree(snapshot): Node` — `Node = {id, name, spouse, parent_id, children: Node[], updated_by, updated_at, draft?: 'added'|'changed'|'moved'}`, дети по `pos`.
    - `applyOps(snapshot, ops): snapshot` — те же правила, что SQL (удаление ветки, add_parent меняет `root_id`, `move` запрещает цикл); помечает затронутых `draft`; не мутирует вход; при неприменимой операции бросает `Error(code)` с кодами как в SQL.
    - `describeOp(op, snapshot): string` — по-русски, без склонения имён, ровно такие шаблоны: `'Добавлен ребёнок: Али (родитель — Магомед)'`; `'Добавлен предок: Хасан (ребёнок — Магомед)'`; `'Исправлено имя: Али → Алий'`; `'Подпись о супруге у Али: жена Асият'`; `'Перенесён: Али (новый родитель — Расул)'`; `'Удалена ветка: Патимат — 12 чел.'` (для одного человека `'Удалён: Патимат'`); `'Брак: Али и Патимат'`; `'Убран брак: Али и Патимат'`.
    - `countBranch(snapshot, personId): number`.
- [ ] **Step 1: Тесты:** `norm('ХӀасан') === norm('XIасан'.replace('X','Х'))`, `norm('Хlасан')`, `norm('Х1асан')`, `norm('Алёна') === norm('Алена')`; `validateName` три ошибки и `'  Али '→'Али'`; `buildTree` порядок детей по `pos`; `applyOps` с теми же сценариями, что Task 2 (`delete branch`, `cycle`, `add_parent`), результат совпадает с ожидаемым; `describeOp` для каждого `type` — ровно строки выше; `countBranch` на ветке из 3 → 3.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS. **Step 5:** Commit `модель древа и имена`.

### Task 5: Черновик, токены, API

**Files:**
- Create: `js/draft.js`, `js/tokens.js`, `js/api.js`, `js/config.js`
- Test: `tests/unit/draft.test.mjs`, `tests/unit/tokens.test.mjs`

**Interfaces:**
- Consumes: `applyOps`, `describeOp` (Task 4).
- Produces:
  - `tokens.js`: `newToken(): string`; `derive(owner, 'edit'|'view'): Promise<string>`; `hashToken(t): Promise<string>` (hex sha256, совпадает с SQL); `treeLink(token): string`; `readTokenFromHash(location.hash): string|null`.
  - `draft.js`: `createDraft(treeId, storage = safeLocalStorage()): Draft`, где `Draft = {ops, baseVersion, persistent: boolean, add(op), remove(index), clear(), setBase(v), onChange(fn)}`; ключ хранения `drevo:draft:<treeId>`; `safeLocalStorage()` возвращает `null`, если доступ бросает.
  - `api.js`: `getApi(): Api` — `window.__TEST_API__ ?? supabaseApi`; `Api = {createTree(title, rootName, hashes), openTree(token), treeVersion(token), saveChanges(token, author, baseVersion, ops, force), getHistory(token, limit, before), revert(token, author, saveId, editId), deletedItems(token)}` — 1:1 с RPC, ошибки Postgres превращает в `Error(code)` (`tree_not_found`, `forbidden`, …).
  - `config.js`: `export const SUPABASE_URL = ''`, `SUPABASE_ANON_KEY = ''`, `BASE_URL` (вычисляется из `location`, без хардкода домена — чтобы свой домен подключался без правок).
- [ ] **Step 1: Тесты:** `derive` детерминирован и даёт 22 символа `[A-Za-z0-9_-]`; `hashToken('abc')` === `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`; черновик переживает пересоздание с тем же хранилищем (`ops`, `baseVersion`); `remove(1)` убирает только вторую; `draft without storage` (Review Focus 4): хранилище, у которого `getItem` бросает → `persistent === false`, `add` работает.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS. **Step 5:** Commit `черновик, токены, API`.

### Task 6: Главная и создание древа

**Files:**
- Create: `index.html`, `css/site.css`, `js/create.js`, `js/share.js`, `tests/e2e/fake-api.js`, `tests/e2e/home.spec.mjs`, `playwright.config.mjs` (локальный сервер `npx http-server -p 4173` или `python3 -m http.server 4173`; проекты 390×844 и 1280×800)

**Interfaces:**
- Consumes: `getApi`, `newToken`, `derive`, `hashToken`, `treeLink`, `validateName`.
- Produces: `tests/e2e/fake-api.js` — `installFakeApi(page, seed?)`: через `page.addInitScript` ставит `window.__TEST_API__` с тем же поведением, что SQL (на `applyOps` из `js/model.js`), хранит состояние в `sessionStorage`. `share.js`: `renderShare(el, {owner?, edit, view})` — для каждой ссылки «Отправить в WhatsApp» (`https://wa.me/?text=` + encodeURIComponent) и «Копировать».

Вид: в духе исходной страницы — бумага `#EEF0EC`/лист `#F8F9F6`, чернила `#1E2624`, акцент `#8B2D3B`, PT Serif для заголовков; тёмная тема — по `prefers-color-scheme`. Название сайта — «Родовое древо».

- [ ] **Step 1: Тест `home.spec.mjs`:** ввести «Магомед» → «Создать древо» → видны три ссылки, текст предупреждения содержит `«Сохраните эту ссылку — восстановить её нельзя»`, ссылка создателя ведёт на `tree.html#t=`; пустое имя → `«Введите имя»`; на главной есть ссылка «Посмотреть пример» на `tree.html#t=romanovy`; на 390 нет горизонтальной прокрутки (`scrollWidth <= 390`).
- [ ] **Step 2:** FAIL. **Step 3:** реализовать; название древа — `'Род ' + имя` (можно поправить на экране создания). Ссылку создателя сохранить в `localStorage` `drevo:my-trees` (список `{title, owner}`) и показать на главной блок «Мои древа», если не пусто. **Step 4:** PASS. **Step 5:** Commit `главная и создание древа`.

### Task 7: Страница древа: просмотр, поиск, панель, черновик и сохранение

**Files:**
- Create: `tree.html`, `js/tree-page.js`, `js/tree-view.js`, `js/panel.js`, `js/draft-bar.js`
- Test: `tests/e2e/tree.spec.mjs`

**Interfaces:**
- Consumes: всё из Tasks 4–6.
- Produces: `tree-view.js`: `createTreeView(svgEl, {onSelect(id)}) → {render(rootNode, {query, selectedId}), focus(id)}` — перенос d3-кода из `<исходный проект>/src/page.html` (раскрытие по нажатию, ширина столбца по самой длинной подписи, линии от конца имени родителя, `paint-order` обводка текста); убрать всё, что специфично для той семьи (сёстры, «сомнительные», жёсткие номера поколений). `tree-page.js`: `state = {token, role, snapshot, draft}`; опрос `treeVersion` раз в 15 с, при смене — перечитать снимок и наложить черновик.

Поведение:
- Сверху: название, число людей, поиск, «Пригласить родных» (для `edit`/`owner`), «Плакат PDF», «История» (для `edit`/`owner`).
- Панель (снизу на 390, справа на 1280): имя, подпись о супруге, «＋ ребёнок», «＋ родитель» (только у корня), «Перенести к…» (выбор через поиск), «Брак с…», «Удалить» (с текстом «Будет удалено N чел.» и подтверждением), «Изменил <имя>, <когда>». Для `view` панель только читает.
- Полоска черновика: `«N несохранённых изменений · Посмотреть · Сохранить»`; список — строки `describeOp`, у каждой «убрать», внизу «Отменить всё». При первом сохранении спросить «Как вас подписать?» и запомнить в `localStorage` `drevo:author`. Конфликт: показать список `«Али — уже изменил Расул, 5 мин назад»` / `«… — удалён»` и кнопки «Сохранить поверх» и «Убрать эти пункты».
- Если `draft.persistent === false` — строка `«Изменения не переживут закрытие вкладки»`.

- [ ] **Step 1: Тесты** (на обеих ширинах, с `fake-api`):
  - `view role is read-only`: нет «Сохранить», «Удалить», «История».
  - `draft and save`: добавить двух детей, поправить имя, удалить ветку из 2 → полоска «4 несохранённых изменения»; во второй вкладке (новый контекст, та же ссылка) их не видно; «Сохранить» → вторая вкладка после опроса (ускорить таймер в тесте) видит изменения.
  - `draft survives reload`.
  - `conflict`: вкладка B сохраняет правку Али, вкладка A сохраняет свою правку Али → виден текст конфликта; «Убрать эти пункты» убирает пункт про Али.
  - `search`: запрос `XIасан` (латиница) находит `ХӀасан`.
  - `no overlap`: раскрыть все ветки; ни один `text` не пересекается с другим (`getBBox` попарно в пределах колонки).
  - `unknown token` (Review Focus 5): `tree.html#t=abc` → текст `«Древо не найдено. Проверьте, что ссылка скопирована целиком.»`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS. **Step 5:** Commit `страница древа`.

### Task 8: История и откат

**Files:**
- Create: `js/history.js`
- Modify: `tree.html`, `js/tree-page.js`
- Test: `tests/e2e/history.spec.mjs`

**Interfaces:**
- Consumes: `getHistory`, `revert`, `deletedItems`, `describeOp`.
- Produces: `openHistory(container, state)`.

Экран: список сохранений «Расул · вчера, 18:40» и под ним строки `describeOp`. У `owner` — «Откатить всё сохранение» и «Откатить» у каждой строки, вкладка «Удалённое» с «Вернуть». Перед откатом с `warnings` — подтверждение «После этого Али ещё менял Расул. Всё равно откатить?». Откаченные строки зачёркнуты с пометкой «откачено».

- [ ] **Step 1: Тесты:** `edit sees history without revert buttons`; `owner restores deleted branch` (удалить ветку из 3, сохранить, «Удалённое» → «Вернуть» → все трое снова в древе); `owner reverts single edit`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS. **Step 5:** Commit `история и откат`.

### Task 9: Плакат PDF

**Files:**
- Create: `js/poster/layouts.js`, `js/poster/pdf.js`, `js/poster/dialog.js`, `vendor/jspdf.umd.min.js`, `vendor/svg2pdf.umd.min.js` (точные версии с jsdelivr), `vendor/fonts/PTSerif-Regular.ttf`, `-Bold.ttf`, `-Italic.ttf` (из `google/fonts` `ofl/ptserif`, OFL; положить `vendor/fonts/OFL.txt`)
- Test: `tests/unit/layouts.test.mjs` (через `linkedom` или в Playwright — на выбор; если `linkedom`, добавить в devDependencies), `tests/e2e/poster.spec.mjs`

**Interfaces:**
- Consumes: `buildTree`, `Node`.
- Produces:
  - `PAPER = {A0:[841,1189], A1:[594,841], A2:[420,594], A3:[297,420], A4:[210,297]}`, `DESIGNS = [{id:'classic', title:'Классика'}, {id:'topdown', title:'Сверху вниз'}, {id:'fan', title:'Круг'}, {id:'gold', title:'Тёмный с золотом'}]`.
  - `renderPoster(root: Node, {design, paper, title, subtitle}, doc = document): SVGSVGElement` — `viewBox` в миллиметрах размера листа, все тексты `font-family="PT Serif"`.
  - `posterPdf(svg, paper): Promise<Blob>`; `downloadPoster(...)` — имя файла `Rod_<транслит названия>_<design>_<paper>.pdf`.

Дизайны: `classic` — перенос `<исходный проект>/src/poster.html` (d3.tree слева направо, столбцы-поколения с римскими цифрами, бордовая рамка); `topdown` — d3.tree сверху вниз, имена в скруглённых рамках, ортогональные линии; при ширине больше листа — подписи поворачиваются на 90° у нижних поколений; `fan` — радиальная веерная диаграмма (d3.partition по углу, кольца — поколения, подписи вдоль радиуса во внешних кольцах); `gold` — d3.tree снизу вверх, фон `#1C2422`, линии и рамка `#C9A35B`, имена `#E9D9B0`. Размер шрифта подбирается, чтобы всё влезло; минимум 1.2 мм (≈3.4 pt) — если не влезает, сайт предупреждает «На A4 имена будут очень мелкими, выберите размер больше».

- [ ] **Step 1: Тесты:** `layouts render 400 people` (Review Focus 3): синтетическое древо 400 человек (вымышленные имена) × 4 дизайна × A0 и A4 — не бросает, число `<text>` с именами === 400, `viewBox` === размер листа; `excludes deleted` — на снимке без удалённых их имён нет; e2e: «Плакат PDF» → выбрать «Круг», A3 → скачивается файл `.pdf` > 10 КБ, первые байты `%PDF`; текст `ХӀ` есть в PDF (извлечь через `pdfjs-dist` или проверить, что шрифт `PTSerif` встроен — `/FontFile2` в байтах).
- [ ] **Step 2:** FAIL. **Step 3:** реализовать; окно — превью (тот же SVG, уменьшенный), выбор дизайна плитками и размера, «Скачать PDF»; на время генерации — «Готовлю плакат…». **Step 4:** PASS. **Step 5:** Commit `плакат PDF`.

### Task 10: Пример — Романовы

**Files:**
- Create: `data/romanov.json`, `scripts/build-example.mjs`, `supabase/example.sql`
- Test: `tests/unit/romanov.test.mjs`

**Interfaces:**
- Consumes: формат операций, `create_tree`/`save_changes` (Task 1–2).
- Produces: `data/romanov.json` — `{title:'Романовы', subtitle, root:{n, sp?, c?:[...]}}` (формат как в исходном проекте: `n` имя с годами жизни в скобках, например `'Пётр I (1672–1725)'`, `sp` супруги). `example.sql` создаёт древо с `is_example=true`, токен просмотра `romanovy` (его хэш), токены владельца и родни — случайные, печатаются в консоль скрипта и **не** сохраняются в репозиторий.

Объём: от Михаила Фёдоровича до 1917 года, все дети каждого монарха (включая умерших в детстве — по Википедии), дочери с супругами в `sp`; линия Анны Петровны → Пётр III → Павел I и далее. Морганатические ветви — нет. Ориентир 100–300 человек. Каждого человека сверить со статьями «Романовы» и «Список детей российских монархов» в русской Википедии.

- [ ] **Step 1: Тест:** JSON валиден, корень `'Михаил Фёдорович (1596–1645)'`, есть `'Пётр I'`, `'Николай II'`, `'Алексей Николаевич'`; 100 ≤ людей ≤ 300; нет пустых имён; все имена проходят `validateName`.
- [ ] **Step 2:** FAIL. **Step 3:** собрать данные, сверяя по Википедии (WebSearch/WebFetch); `build-example.mjs` пишет SQL. **Step 4:** PASS; `example.sql` применяется к PGlite после `schema.sql` и `open_tree('romanovy').role === 'view'`. **Step 5:** Commit `пример: Романовы`.

### Task 11: Supabase, GitHub, Pages, будильник базы

Нужно от владельца: проект Supabase, его URL, anon-ключ и строка подключения к базе (Settings → Database → Connection string, URI). Без этого задача ждёт.

**Files:**
- Create: `scripts/apply-sql.mjs`, `.github/workflows/keepalive.yml`, `README.md`
- Modify: `js/config.js`

**Interfaces:**
- `node scripts/apply-sql.mjs supabase/schema.sql supabase/example.sql` — с `SUPABASE_DB_URL` из окружения (не коммитить).

- [ ] **Step 1:** применить SQL; проверка: `curl -s -X POST "$URL/rest/v1/rpc/ping" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}'` → `1`; `curl ... /rest/v1/people` → ошибка доступа; `rpc/open_tree` с `{"p_token":"romanovy"}` → `"role":"view"`.
- [ ] **Step 2:** вписать URL и anon-ключ в `js/config.js` (anon-ключ публичный по замыслу Supabase; service role — никогда).
- [ ] **Step 3:** `keepalive.yml`: cron `0 6 */3 * *` и `workflow_dispatch`, шаг — тот же `curl rpc/ping`, URL и ключ из `secrets.SUPABASE_URL` / `secrets.SUPABASE_ANON_KEY`.
- [ ] **Step 4:** перед публикацией: `git grep -i -E '<фамилия рода латиницей и кириллицей>|<имена из private/family-migration.md>'` пусто (список слов взять из `private/`, в команду не коммитить); `npm test` зелёный.
- [ ] **Step 5:** `gh repo create ibn-arif/rodovoe-drevo --public --source . --push`; `gh secret set` для двух секретов; включить Pages (`gh api -X POST repos/ibn-arif/rodovoe-drevo/pages -f 'source[branch]=main' -f 'source[path]=/'`); запустить `keepalive` вручную — зелёный.
- [ ] **Step 6:** проверка вживую через Playwright на `https://ibn-arif.github.io/rodovoe-drevo/`: создать тестовое древо, добавить ребёнка, сохранить, открыть второй вкладкой, откатить, скачать плакат; пример Романовых открывается. Тестовое древо потом удалить SQL-запросом.
- [ ] **Step 7:** Commit `публикация`, push.

### Task 12: Перенос семейного древа (в `private/`, не в git)

Выполняет основная сессия (нужны инструменты артефактов), не субагент.

- [ ] **Step 1:** найти опубликованную страницу семейного древа на claude.ai (`Artifact list`), выгрузить коллекции `fixes`, `adds`, `marriages` (`ArtifactData list`) в `<исходный проект>/data/edits/`; `python3 build.py` там; сравнить число людей с прежним (366) и сообщить разницу.
- [ ] **Step 2:** `private/import-family.mjs`: читает `<исходный проект>/data/final.json`, создаёт древо через `create_tree` (новые токены), одним `save_changes` от автора «Перенос» добавляет всех людей (`add_child` с клиентскими uuid, `spouse` из `sp`) и браки из `mar`.
- [ ] **Step 3:** проверка: `open_tree(owner).people.length` равно числу людей в `final.json`; браков столько же; три ссылки — только владельцу в чате; в git ничего нового (`git status` чистый).
