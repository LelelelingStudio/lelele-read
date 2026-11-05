/* =========================================================
   user-api.js - 「了了了读」唯一数据出入口
   当前 BACKEND_MODE = 'local'：用 localStorage 模拟，站点零后端也能完整跑通。
   后端（独立 Supabase）就绪后：填 URL / anon key，把 BACKEND_MODE 改成 'supabase'，
   并在 _request() 里换成 supabase-js 调用即可；所有方法签名保持不变。
   详见 docs/handoff/backend-supabase.md
   ========================================================= */
window.UserAPI = (function () {
    'use strict';

    // ---- Gemini 已交付的凭证（仅 anon key，service_role 绝不进前端） ----
    const SUPABASE_URL = 'https://leicachifzfftjmafods.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlaWNhY2hpZnpmZnRqbWFmb2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NDY2MzMsImV4cCI6MjEwOTQyMjYzM30.gYnkhPD4-ivgAi_Ynu-Fi_D-GUysTsjfNrNMvuJJgHI';
    const BACKEND_MODE = 'supabase';

    const PREFIX = 'lelele_read_api_';
    const SESSION_KEY = PREFIX + 'session';
    const PROFILE_KEY = PREFIX + 'profile_';
    const SUBMISSION_KEY = PREFIX + 'submissions_';
    const ANNOTATION_KEY = PREFIX + 'annotations_';
    const PROGRESS_KEY = PREFIX + 'progress_';

    function read(key, fallback) {
        try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
        catch (e) { return fallback; }
    }
    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }
    function ok(data) { return { data: data, error: null }; }
    function fail(msg) { return { data: null, error: { message: msg || '服务暂不可用' } }; }
    function t(zh, en) { return (window.getLang && window.getLang() === 'en') ? en : zh; }
    function uid() { return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function delay(v) { return Promise.resolve(v); }

    /* ---------------- 会话 ---------------- */
    const authListeners = [];

    async function signIn(email, password) {
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) return fail(t('请输入有效邮箱', 'Enter a valid email'));
        if (!password || password.length < 6) return fail(t('密码至少 6 位', 'Password must be at least 6 characters'));
        if (BACKEND_MODE === 'supabase') return supabaseSignIn(email, password);
        const user = { id: 'local_' + email.toLowerCase(), email: email, name: email.split('@')[0] };
        write(SESSION_KEY, user);
        authListeners.forEach(fn => { try { fn(user); } catch (e) { } });
        return ok({ user: user });
    }

    async function signUp(email, password, meta) {
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) return fail(t('请输入有效邮箱', 'Enter a valid email'));
        if (!password || password.length < 6) return fail(t('密码至少 6 位', 'Password must be at least 6 characters'));
        if (BACKEND_MODE === 'supabase') return supabaseSignUp(email, password, meta);
        const user = { id: 'local_' + email.toLowerCase(), email: email, name: (meta && meta.name) || email.split('@')[0] };
        write(SESSION_KEY, user);
        write(PROFILE_KEY + user.id, { display_name: user.name, author_id: '', bio_zh: '', bio_en: '', website: '' });
        authListeners.forEach(fn => { try { fn(user); } catch (e) { } });
        return ok({ user: user });
    }

    async function signInWithOAuth(provider) {
        if (BACKEND_MODE !== 'supabase') return fail(t('第三方登录将在后端就绪后开放', 'Third-party sign-in opens once the backend is ready'));
        return fail(t('尚未配置第三方登录', 'OAuth provider not configured'));
    }

    async function signOut() {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try { await window.ReadSupabase.auth.signOut(); } catch (e) { }
        }
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
        authListeners.forEach(fn => { try { fn(null); } catch (e) { } });
        return ok(null);
    }

    function getSession() { return { user: read(SESSION_KEY, null) }; }
    function onAuthChange(callback) {
        authListeners.push(callback);
        return function () {
            const i = authListeners.indexOf(callback);
            if (i !== -1) authListeners.splice(i, 1);
        };
    }

    /* ---------------- 资料 ---------------- */
    async function getProfile(userId) {
        const id = userId || (getSession().user || {}).id;
        if (!id) return ok(null);
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('profiles').select('*').eq('id', id).single();
                return error ? fail(error.message) : ok(data);
            } catch (e) { return fail(e.message); }
        }
        return delay(ok(Object.assign({ id: id, display_name: '', author_id: '' }, read(PROFILE_KEY + id, {}))));
    }

    async function updateProfile(userId, patch) {
        const id = userId || (getSession().user || {}).id;
        if (!id) return fail(t('请先登录', 'Please sign in first'));
        const clean = Object.assign({}, patch);
        delete clean.level; delete clean.is_official;   // 认证字段只能后台改
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('profiles').update(clean).eq('id', id).select().single();
                return error ? fail(error.message) : ok(data);
            } catch (e) { return fail(e.message); }
        }
        const next = Object.assign({}, read(PROFILE_KEY + id, {}), clean, { id: id, updated_at: new Date().toISOString() });
        write(PROFILE_KEY + id, next);
        return delay(ok(next));
    }

    /* ---------------- 投稿 ---------------- */
    function submissionKey() { return SUBMISSION_KEY + ((getSession().user || {}).id || 'anon'); }

    async function listMySubmissions() {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('submissions').select('*').order('created_at', { ascending: false });
                return error ? fail(error.message) : ok(data || []);
            } catch (e) { return fail(e.message); }
        }
        return delay(ok(read(submissionKey(), [])));
    }

    async function createSubmission(payload) {
        const user = getSession().user;
        if (!user) return fail(t('请先登录', 'Please sign in first'));
        const item = Object.assign({
            id: uid(), title_zh: '', title_en: '', author: '', category: '', icon: '📖',
            summary_zh: '', summary_en: '', data_url: '', status: 'pending', created_at: new Date().toISOString()
        }, payload || {});
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('submissions')
                    .insert({ title_zh: item.title_zh, title_en: item.title_en, author: item.author, category: item.category, icon: item.icon, summary_zh: item.summary_zh, summary_en: item.summary_en, data_url: item.data_url, status: 'pending' }).select().single();
                return error ? fail(error.message) : ok(data);
            } catch (e) { return fail(e.message); }
        }
        const list = read(submissionKey(), []);
        list.unshift(item);
        write(submissionKey(), list);
        return delay(ok(item));
    }

    async function deleteSubmission(id) {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { error } = await window.ReadSupabase.from('submissions').delete().eq('id', id);
                return error ? fail(error.message) : ok(null);
            } catch (e) { return fail(e.message); }
        }
        write(submissionKey(), read(submissionKey(), []).filter(x => x.id !== id));
        return delay(ok(null));
    }

    /* ---------------- 批注 / 进度 ---------------- */
    async function listAnnotations(bookId) {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('annotations').select('*').eq('book_id', bookId);
                return error ? fail(error.message) : ok(data || []);
            } catch (e) { return fail(e.message); }
        }
        return delay(ok(read(ANNOTATION_KEY + bookId, [])));
    }
    async function saveAnnotation(item) {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('annotations').upsert(item).select().single();
                return error ? fail(error.message) : ok(data);
            } catch (e) { return fail(e.message); }
        }
        const list = read(ANNOTATION_KEY + item.book_id, []);
        const i = list.findIndex(x => x.id === item.id);
        if (i === -1) list.unshift(Object.assign({ id: uid() }, item)); else list[i] = item;
        write(ANNOTATION_KEY + item.book_id, list);
        return delay(ok(item));
    }
    async function saveProgress(bookId, progress) {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { error } = await window.ReadSupabase.from('reading_progress').upsert(Object.assign({ book_id: bookId }, progress));
                return error ? fail(error.message) : ok(null);
            } catch (e) { return fail(e.message); }
        }
        write(PROGRESS_KEY + bookId, progress);
        return delay(ok(null));
    }
    async function loadProgress(bookId) {
        if (BACKEND_MODE === 'supabase' && window.ReadSupabase) {
            try {
                const { data, error } = await window.ReadSupabase.from('reading_progress').select('*').eq('book_id', bookId).single();
                return error ? fail(error.message) : ok(data);
            } catch (e) { return fail(e.message); }
        }
        return delay(ok(read(PROGRESS_KEY + bookId, null)));
    }

    /* ---------------- Supabase 分支（后端就绪后启用） ---------------- */
    async function ensureClient() {
        if (window.ReadSupabase) return window.ReadSupabase;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error(t('后端尚未配置', 'Backend not configured'));
        if (!window.supabase) throw new Error(t('Supabase SDK 未加载', 'Supabase SDK not loaded'));
        window.ReadSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return window.ReadSupabase;
    }
    function normalizeUser(u) {
        if (!u) return null;
        return { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.name) || (u.email || '').split('@')[0] };
    }
    function emitAuth(user) {
        if (user) write(SESSION_KEY, user); else { try { localStorage.removeItem(SESSION_KEY); } catch (e) { } }
        authListeners.forEach(fn => { try { fn(user); } catch (e) { } });
    }
    let _booted = false;
    async function bootSupabase() {
        if (_booted || BACKEND_MODE !== 'supabase') return;
        _booted = true;
        try {
            const c = await ensureClient();
            const { data: s } = await c.auth.getSession();
            if (s && s.session && s.session.user) emitAuth(normalizeUser(s.session.user));
            c.auth.onAuthStateChange((event, session) => {
                emitAuth(session && session.user ? normalizeUser(session.user) : null);
            });
        } catch (e) { /* SDK 未加载或网络异常时忽略，待用户主动操作再报错 */ }
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSupabase);
        else bootSupabase();
    }

    async function supabaseSignIn(email, password) {
        const c = await ensureClient();
        const { data, error } = await c.auth.signInWithPassword({ email, password });
        if (error) return fail(error.message);
        if (!data.session) return fail(t('登录未创建会话，可能是邮箱尚未确认', 'Session not created; your email may be unconfirmed'));
        const user = normalizeUser(data.user);
        emitAuth(user);
        return ok({ user: user });
    }
    async function supabaseSignUp(email, password, meta) {
        const c = await ensureClient();
        const { data, error } = await c.auth.signUp({ email, password, options: { data: meta || {} } });
        if (error) return fail(error.message);
        if (data.session && data.user) {
            const user = normalizeUser(data.user);
            emitAuth(user);
            return ok({ user: user });
        }
        // 开启邮件确认时 data.session 为空：返回成功但提示去邮箱
        return ok({ needsConfirmation: true, user: data.user ? normalizeUser(data.user) : null });
    }
    async function supabaseSendOtp(email, createUser) {
        const c = await ensureClient();
        const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: !!createUser } });
        return error ? fail(error.message) : ok({});
    }
    async function supabaseVerifyOtp(email, token, type) {
        const c = await ensureClient();
        const { data, error } = await c.auth.verifyOtp({ email, token, type });
        if (error) return fail(error.message);
        if (!data.session) return fail(t('验证未生成会话', 'Verification did not create a session'));
        const user = normalizeUser(data.user);
        emitAuth(user);
        return ok({ user: user });
    }

    //  readers一键升级为作者（调用 security definer RPC，校验 author_id 唯一与登录态）
    async function becomeAuthor(payload) {
        if (!payload || !payload.authorId) return fail(t('请填写作者标识', 'Author ID required'));
        if (BACKEND_MODE !== 'supabase') {
            const user = getSession().user;
            if (!user) return fail(t('请先登录', 'Please sign in first'));
            const next = Object.assign({}, read(PROFILE_KEY + user.id, {}), {
                is_author: true, role: 'author', author_id: payload.authorId,
                display_name: payload.displayName || '', bio_zh: payload.bioZh || '', bio_en: payload.bioEn || ''
            });
            write(PROFILE_KEY + user.id, next);
            authListeners.forEach(fn => { try { fn(user); } catch (e) { } });
            return delay(ok(next));
        }
        try {
            const c = await ensureClient();
            const { data, error } = await c.rpc('become_author', {
                p_author_id: payload.authorId,
                p_display_name: payload.displayName || null,
                p_bio_zh: payload.bioZh || '',
                p_bio_en: payload.bioEn || ''
            });
            if (error) return fail(mapRpcError(error.message));
            return ok(data);
        } catch (e) { return fail(e.message); }
    }

    // 公开读取作者资料（无需登录，走 authors_public 视图）
    async function getAuthorProfile(authorId) {
        if (BACKEND_MODE !== 'supabase') {
            return delay(ok(Object.assign({ author_id: authorId, display_name: authorId, level: 1 }, read(PROFILE_KEY + 'local_' + authorId, {}))));
        }
        try {
            const c = await ensureClient();
            const { data, error } = await c.from('authors_public').select('*').eq('author_id', authorId).single();
            return error ? fail(error.message) : ok(data);
        } catch (e) { return fail(e.message); }
    }

    function mapRpcError(msg) {
        if (/AUTHOR_ID_TAKEN/.test(msg)) return t('该作者标识已被占用', 'This author ID is taken');
        if (/ALREADY_AUTHOR/.test(msg)) return t('你已是作者', 'You are already an author');
        if (/NOT_AUTHENTICATED/.test(msg)) return t('请先登录', 'Please sign in first');
        return msg;
    }

    // 邮箱验证码（OTP）：发送与校验，适配 4–8 位
    async function sendOtp(email, createUser) {
        if (BACKEND_MODE !== 'supabase') {
            const code = String(Math.floor(10000000 + Math.random() * 90000000));
            write('otp_' + email, code);
            console.log('[local OTP demo] ' + email + ' -> ' + code);
            return delay(ok({}));
        }
        try { return await supabaseSendOtp(email, createUser); } catch (e) { return fail(e.message); }
    }
    async function verifyOtp(email, token, type) {
        if (BACKEND_MODE !== 'supabase') {
            const expect = read('otp_' + email, null);
            if (!expect || expect !== String(token)) return delay(fail(t('验证码错误', 'Wrong code')));
            const user = { id: 'local_' + email, email, name: email.split('@')[0] };
            emitAuth(user);
            return delay(ok({ user }));
        }
        try { return await supabaseVerifyOtp(email, token, type); } catch (e) { return fail(e.message); }
    }

    return {
        config: { SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_MODE },
        signIn, signUp, signInWithOAuth, signOut, getSession, onAuthChange,
        getProfile, updateProfile,
        becomeAuthor, getAuthorProfile,
        sendOtp, verifyOtp,
        listMySubmissions, createSubmission, deleteSubmission,
        listAnnotations, saveAnnotation, saveProgress, loadProgress
    };
})();
