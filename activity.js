/* =========================================
   activity.js - 活动系统与下雪特效核心
   ========================================= */

const ActivitySystem = (function() {
    'use strict';

    const CONFIG_URL = '/activity.json';
    let config = null;

    // ==================== 1. 时间锁校验 ====================
    function isActivityActive() {
        if (!config) return false;
        const now = new Date();
        
        // 强制开启 (用于测试)
        if (config.forceEnable) return true;

        // 1. 检查特殊时间段 (如具体某年某月某日)
        if (config.specialPeriod) {
            const start = new Date(config.specialPeriod.start);
            const end = new Date(config.specialPeriod.end);
            if (now >= start && now <= end) return true;
        }

        // 2. 检查每年循环时间段 (如每年的11-01到12-31)
        if (config.yearlyPeriod) {
            const currentYear = now.getFullYear();
            const startStr = `${currentYear}-${config.yearlyPeriod.start}`;
            let endStr = `${currentYear}-${config.yearlyPeriod.end}`;
            
            const start = new Date(startStr);
            let end = new Date(endStr);
            // 跨年情况 (如 12-15 到 01-15)
            if (end < start) {
                end = new Date(`${currentYear + 1}-${config.yearlyPeriod.end}`);
            }
            if (now >= start && now <= end) return true;
        }

        return false;
    }

    // ==================== 2. 下雪特效算法 ====================
    function initSnowfall() {
        if (document.getElementById('activity-snowfall-canvas')) return;

        const canvas = document.createElement('canvas');
        canvas.id = 'activity-snowfall-canvas';
        document.body.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        const snowflakes = [];
        
        // 移动端减少雪花数量以保证性能
        const maxSnowflakes = width < 768 ? 40 : 100; 
        
        for (let i = 0; i < maxSnowflakes; i++) {
            snowflakes.push({
                x: Math.random() * width, 
                y: Math.random() * height,
                r: Math.random() * 3 + 1, // 半径
                d: Math.random() * maxSnowflakes, // 密度
                speedY: Math.random() * 1 + 0.5, // 垂直速度
                speedX: Math.random() * 1 - 0.5  // 水平摇摆
            });
        }
        
        function draw() {
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            for (let i = 0; i < maxSnowflakes; i++) {
                const f = snowflakes[i];
                ctx.moveTo(f.x, f.y);
                ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2, true);
            }
            ctx.fill();
            update();
        }
        
        let angle = 0;
        function update() {
            angle += 0.01;
            for (let i = 0; i < maxSnowflakes; i++) {
                const f = snowflakes[i];
                // 飘落逻辑
                f.y += Math.cos(angle + f.d) + f.speedY;
                f.x += Math.sin(angle) * 1.5 + f.speedX;
                
                // 边界重置
                if (f.y > height) { f.y = -5; f.x = Math.random() * width; }
                if (f.x > width) f.x = 0;
                if (f.x < 0) f.x = width;
            }
        }
        
        function loop() { 
            draw(); 
            requestAnimationFrame(loop); 
        }
        loop();
        
        window.addEventListener('resize', () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        });
    }

    // ==================== 3. 核心应用逻辑 ====================
    async function applyActivity() {
        // 获取当前页面路径，判断是否需要跳过特效（比如阅读器内部请求了跳过）
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('no_effect') === '1' || document.body.hasAttribute('data-skip-activity')) {
            document.documentElement.classList.add('skip-effects');
            return;
        }

        try {
            const res = await fetch(CONFIG_URL + '?t=' + Date.now());
            if (!res.ok) return;
            config = await res.json();

            if (!isActivityActive()) return;

            // 1. 给 HTML 加类名
            document.documentElement.classList.add('activity-mode');

            // 2. 替换全站背景
            if (config.assets && config.assets.background) {
                document.documentElement.style.setProperty('--activity-bg-image', `url('${config.assets.background}')`);
            }

            // 3. 替换 Logo 和 Favicon
            if (config.assets) {
                if (config.assets.favicon) {
                    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(el => {
                        el.href = config.assets.favicon;
                    });
                }
                if (config.assets.logo) {
                    document.querySelectorAll('.site-logo').forEach(img => {
                        img.src = config.assets.logo;
                    });
                }
            }

            // 4. 插入 Banner
            if (config.assets && config.assets.banner) {
                const bannerContainer = document.createElement('div');
                bannerContainer.className = 'activity-banner-container';
                bannerContainer.innerHTML = `<img src="${config.assets.banner}" alt="Activity Banner">`;
                
                // 尝试找特定的占位元素，找不到就插到 body 最前面（或者主内容区前面）
                const placeholder = document.getElementById('activityBannerPlaceholder');
                if (placeholder) {
                    placeholder.appendChild(bannerContainer);
                } else {
                    // 默认插入到 .reader-main 或 body 顶部
                    const mainContent = document.querySelector('.reader-main') || document.body;
                    mainContent.insertBefore(bannerContainer, mainContent.firstChild);
                }
            }

            // 5. 插入挂件
            if (config.assets && config.assets.snowman) {
                const snowman = document.createElement('img');
                snowman.src = config.assets.snowman;
                snowman.className = 'activity-sticker snowman';
                document.body.appendChild(snowman);
            }
            if (config.assets && config.assets.tree) {
                const tree = document.createElement('img');
                tree.src = config.assets.tree;
                tree.className = 'activity-sticker tree';
                document.body.appendChild(tree);
            }

            // 6. 开启下雪特效
            if (config.enableSnowfall) {
                initSnowfall();
            }

        } catch (e) {
            console.warn('活动主题加载失败:', e);
        }
    }

    // ==================== 4. 初始化入口 ====================
    function init() {
        // 延迟执行，避免与首屏渲染抢资源
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(applyActivity, 200));
        } else {
            setTimeout(applyActivity, 200);
        }
    }

    return { init };
})();

// 自动启动
ActivitySystem.init();