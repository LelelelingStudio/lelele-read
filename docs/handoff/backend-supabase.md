# 了了了读 · 后端补充改造：双身份体系 + 读者一键升级作者

> 复制本文件全文发给 Gemini。
> 背景：Supabase 项目 `lelele-read` 已按上一轮指南搭建完成（4 张表 + 新用户触发器）。本文档是**在已搭好的项目上执行的增量改造**，让系统同时服务「读者」与「作者」两类身份，并支持读者用同一账号一键升级为作者。
> 前端 `user-api.js` 已按本文件的契约写好，Gemini 跑完第 3 节 SQL 后即可联调。

---

## 0. 给 Gemini 的总指令（请原样执行）

```
你是我的后端改造助手。请按本文件，在已建好的 Supabase 项目 lelele-read（URL 与 anon key 沿用上一轮已交付的，不要新建项目）上执行增量改造。
要求：
1. 每一步给可直接粘贴的完整 SQL，且全部幂等（可重复执行）。
2. 执行前告诉我会在哪个页面（SQL Editor / Auth / Policies）粘贴。
3. 完成后按第 5 节验收清单逐条核对，并把第 6 节「交给前端的信息表」填好回传。
4. 全程不要修改前端仓库文件，只产出配置与 SQL。
```

---

## 1. 现状确认（Gemini 已交付，无需重做）

- 独立项目 `lelele-read`，**未**与「了了了游」任何项目混用。
- 4 张表均开启 RLS：`profiles`、`submissions`、`annotations`、`reading_progress`。
- 触发器 `handle_new_user`：注册后自动在 `public.profiles` 建基础行（当前仅读者身份）。
- Site URL = `https://read.leleleling.site`；Redirect URLs 含 `http://localhost:8000/**`。
- 已交付 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY`（仅 anon key 进前端，service_role 绝不进仓库）。

---

## 2. 新需求：双身份（读者 / 作者）+ 读者一键升级

**建模决策（请确认后执行）**：采用「单一 `auth.users` 认证 + `profiles` 双角色」模型，不拆成两个独立 Supabase 项目（否则无法「一键互通」）。

- **读者身份**：默认。可阅读、书签、批注、记录进度。
- **作者身份**：在 `profiles` 上通过 `is_author=true` + `author_id` 标识。可进 `dashboard.html` 编辑资料、投稿、查看认证等级。
- **一键升级（核心）**：读者登录态下，点「成为作者」→ 填作者标识（`author_id`，如 `luxun`）→ 前端调用 RPC `become_author` → 同一账号即拥有作者身份，**无需重新注册、无需再输密码**。
- **回流**：作者用同一账号登录后，根据 `is_author` 自动显示读者/作者两套入口。

> 这与前端「零共用原则」一致：作者公开总表仍来自 `https://authors.surge.sh/lelelereadauthor.json`（静态 JSON），后端只负责登录态内的资料、投稿、云端批注。

---

## 3. 数据库增量改造 SQL（全部幂等，在 SQL Editor 依次执行）

```sql
-- 3.1 profiles 扩展双身份字段
alter table public.profiles
  add column if not exists role         text    not null default 'reader' check (role in ('reader','author')),
  add column if not exists is_author    boolean not null default false,
  add column if not exists author_id    text,
  add column if not exists display_name text,
  add column if not exists bio_zh       text    default '',
  add column if not exists bio_en       text    default '',
  add column if not exists website      text    default '',
  add column if not exists avatar_url   text,
  add column if not exists level        int     not null default 1,
  add column if not exists is_official boolean not null default false;

-- 3.2 author_id 唯一（仅对作者生效，避免重名抢注）
create unique index if not exists profiles_author_id_key
  on public.profiles (author_id) where author_id is not null;

-- 3.3 公开作者视图：供 author.html 与跨域索引读取，绝不暴露邮箱等敏感字段
create or replace view public.authors_public as
  select id, author_id, display_name, bio_zh, bio_en, website, avatar_url, level, is_official
  from public.profiles where is_author = true;

-- 3.4 一键升级 RPC（security definer，校验唯一性与登录态）
create or replace function public.become_author(
  p_author_id text,
  p_display_name text default null,
  p_bio_zh text default '',
  p_bio_en text default ''
) returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from public.profiles where author_id = p_author_id) then
    raise exception 'AUTHOR_ID_TAKEN';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and is_author = true) then
    raise exception 'ALREADY_AUTHOR';
  end if;
  update public.profiles
    set is_author    = true,
        role         = 'author',
        author_id    = p_author_id,
        display_name = coalesce(p_display_name, display_name),
        bio_zh       = p_bio_zh,
        bio_en       = p_bio_en
  where id = v_uid;
  select * into v_row from public.profiles where id = v_uid;
  return v_row;
end;
$$;
revoke all on function public.become_author(text,text,text,text) from anon, authenticated;
grant  execute on function public.become_author(text,text,text,text) to authenticated;

-- 3.5 保护特权字段：禁止用户自己改 level / is_official（管理员用 service_role 可改）
create or replace function public.protect_profile_privileged()
returns trigger language plpgsql as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  if new.level is distinct from old.level or new.is_official is distinct from old.is_official then
    raise exception 'CANNOT_MODIFY_PRIVILEGED_FIELDS';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile_privileged();

-- 3.6 submissions 增加审核状态与公开读
alter table public.submissions
  add column if not exists status text not null default 'pending'
  check (status in ('pending','approved','rejected'));
```

### 3.7 RLS 策略（在表编辑器 → Policies 补全）

**profiles**
- Select：`using (true)`（公开读，供作者主页/索引；邮箱等敏感字段本就不在 `authors_public` 视图内，profiles 表本身也只存非敏感资料）
- Update：`using (auth.uid() = id) with check (auth.uid() = id)`（特权字段由 3.5 触发器兜底保护）

**submissions**
- Select：`using (status = 'approved' or auth.uid() = user_id)`
- Insert：`with check (auth.uid() = user_id)`
- Update / Delete：`using (auth.uid() = user_id)`

**annotations / reading_progress**：保持本人私有（`using (auth.uid() = user_id)`）。

---

## 4. 前端对接契约（user-api.js 已就绪，待填凭证）

1. 在 `user-api.js` 顶部把 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 填为已交付的值，`BACKEND_MODE` 改为 `'supabase'`。
2. 页面需自托管 `supabase-js`（根目录 `supabase-js.min.js`），并在 `user-api.js` 之前用 `<script src="supabase-js.min.js"></script>` 引入（`ensureClient()` 会自动 `createClient`）。
3. 新增方法（已内置）：
   - `UserAPI.becomeAuthor({ authorId, displayName, bioZh, bioEn })` → 调 RPC `become_author`；错误码 `AUTHOR_ID_TAKEN` / `ALREADY_AUTHOR` / `NOT_AUTHENTICATED`。
   - `UserAPI.getAuthorProfile(authorId)` → 查 `authors_public` 视图（公开，无需登录）。
4. 登录后前端判断 `profile.is_author`：
   - `false` → 顶栏/后台显示「成为作者」按钮，点击弹窗收集 `author_id` 后调 `becomeAuthor`。
   - `true` → 显示「作者后台」「投稿」入口。
5. `dashboard.html` 资料表单：创建作者后 `author_id` 只读；`level` 与官方徽章只读展示。

---

## 5. 验收清单（带我逐条核对）

- [ ] 注册读者 → `profiles` 自动建行，`role='reader'`、`is_author=false`。
- [ ] 读者登录 → 点「成为作者」填 `author_id=luxun` → `become_author` 成功，`is_author=true`，可进 `dashboard.html` 投稿。
- [ ] 重复 `author_id` 被拒，错误码 `AUTHOR_ID_TAKEN`。
- [ ] 已是作者再次调用被拒，错误码 `ALREADY_AUTHOR`。
- [ ] `author.html?id=luxun` 能读到公开资料（经 `authors_public` 视图）。
- [ ] 普通用户无法自改 `level` / `is_official`（触发器拦截）。
- [ ] `submissions` 审核通过（`status='approved'`）后，未登录也能在共创书库看到。
- [ ] 全程未将 `service_role` 写入任何前端文件或聊天。

---

## 6. 交给前端的信息表（Gemini 填好后回传）

| 项 | 值 |
| --- | --- |
| SUPABASE_URL | （沿用已交付） |
| SUPABASE_ANON_KEY | （沿用已交付，仅 anon） |
| 一键升级 RPC | `become_author(author_id, display_name, bio_zh, bio_en)` |
| 公开作者视图 | `authors_public`（author_id, display_name, bio_zh, bio_en, website, avatar_url, level, is_official） |
| 投稿公开读条件 | `submissions.status = 'approved'` |
| 特权字段保护 | 触发器 `trg_protect_profile`（service_role 可改 level/is_official） |
| 自评结论 | 双身份 + 一键升级是否完成：______ |
