/**
 * 指令触发：
 * 连板分析               // 默认当前日期
 * 连板分析 20220701      // 指定日期
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const got = require('got');
const moment = require('moment-timezone');
const {
    sendNotify,
    addOrUpdateCustomDataTitle,
    addCustomData,
    getCustomData
} = require('./quantum');

// ---------- 配置 ----------
const api = got.extend({
    retry: { limit: 0 },
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});
const CUSTOM_DATA_TYPE = 'lianbanfenxi';
const HOLIDAY_CACHE_FILE = path.join(__dirname, 'holidays_cache.json');
const PY_SCRIPT = path.join(__dirname, 'search_cls.py');

// ---------- 财联社 API 签名 ----------
function generateSign(params) {
    const BASE = { appName: 'CailianpressWeb', os: 'web', sv: '8.7.9' };
    const merged = { ...BASE, ...params };
    const sortedKeys = Object.keys(merged).sort();
    const qs = sortedKeys.map(k =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(merged[k]))}`
    ).join('&');
    const sha1 = crypto.createHash('sha1').update(qs).digest('hex');
    const sign = crypto.createHash('md5').update(sha1).digest('hex');
    return { ...merged, sign };
}

// ---------- 搜索文章（API 快路径：今日或最近交易日）----------
async function searchArticleByKeyword(datePrefix) {
    const params = generateSign({ Subject_Id: '1103' });
    const qs = Object.entries(params).map(([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    ).join('&');
    const url = `https://www.cls.cn/api/subject/1103/article?${qs}`;
    const body = await api.get(url).json();
    const items = body.data || [];
    // 精确匹配日期前缀（如 6月18日连板股分析）
    const matched = items.filter(item =>
        (item.article_title || '').includes(datePrefix)
    );
    // 获取完整内容
    const results = [];
    for (const item of matched) {
        const detail = await fetchArticleDetail(item.article_id);
        results.push({
            id: item.article_id,
            time: item.article_time,
            title: item.article_title,
            descr: detail.content || item.article_brief || item.article_title,
            img: item.article_img || (detail.images && detail.images[0]) || '',
        });
    }
    return results;
}

// ---------- 通过 detail 页获取完整内容 ----------
async function fetchArticleDetail(articleId) {
    try {
        const html = await api.get(`https://www.cls.cn/detail/${articleId}`).text();
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/);
        if (m) {
            const nd = JSON.parse(m[1]);
            const ad = nd.props.pageProps.articleDetail || {};
            return {
                content: ad.content || ad.brief || '',
                images: ad.images || [],
            };
        }
    } catch (e) {
        console.log(`获取详情失败 ID=${articleId}: ${e.message}`);
    }
    return { content: '', images: [] };
}

// ---------- 通过 Python Playwright 搜索历史文章 ----------
async function searchArticleByPython(targetDateStr) {
    return new Promise((resolve, reject) => {
        execFile('python3', [PY_SCRIPT, '--json', targetDateStr], {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Python 搜索失败: ${err.message}`));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                const articles = result.articles || [];
                resolve(articles.map(a => ({
                    id: a.id,
                    time: a.ctime || 0,
                    title: a.title || '',
                    descr: a.content || a.brief || a.title || '',
                    img: a.img || '',
                })));
            } catch (e) {
                reject(new Error(`解析 Python 输出失败: ${e.message}`));
            }
        });
    });
}

// ---------- 搜索入口 ----------
async function searchArticles(targetDate) {
    const datePrefix = targetDate.format('M月D日连板股分析');
    const isToday = !targetDate || targetDate.isSame(moment().tz('Asia/Shanghai'), 'day');
    if (isToday) {
        return await searchArticleByKeyword(datePrefix);
    } else {
        return await searchArticleByPython(targetDate.format('YYYYMMDD'));
    }
}

function getBestMatchingArticle(articles, targetDate) {
    if (!articles.length) return null;
    const targetTimestamp = targetDate.startOf('day').unix();
    let bestMatch = null;
    let minDiff = Infinity;
    for (const art of articles) {
        const diff = Math.abs(art.time - targetTimestamp);
        if (diff < minDiff) {
            minDiff = diff;
            bestMatch = art;
        }
    }
    return bestMatch;
}

// ---------- 节假日缓存逻辑 ----------
async function getYearHolidayData(year) {
    let cache = null;
    if (fs.existsSync(HOLIDAY_CACHE_FILE)) {
        try {
            const raw = fs.readFileSync(HOLIDAY_CACHE_FILE, 'utf8');
            cache = JSON.parse(raw);
        } catch (e) {
            console.log(`读取缓存文件失败：${e.message}`);
        }
    }
    if (cache?.data?.[year]) {
        console.log(`使用缓存的 ${year} 年节假日数据`);
        const yearData = cache.data[year];
        return {
            holidays: new Set(yearData.holidays || []),
            workdays: new Set(yearData.workdays || [])
        };
    }
    console.log(`从网络获取 ${year} 年节假日数据...`);
    const url = `https://timor.tech/api/holiday/year/${year}`;
    try {
        const response = await api.get(url).json();
        if (response.code !== 0 || !response.holiday) {
            throw new Error('API 返回异常');
        }
        const holidays = new Set();
        const workdays = new Set();
        for (const [date, info] of Object.entries(response.holiday)) {
            if (info.holiday) holidays.add(date);
            if (info.work) workdays.add(date);
        }
        const newCache = cache || { data: {} };
        newCache.data[year] = {
            holidays: Array.from(holidays),
            workdays: Array.from(workdays)
        };
        newCache.lastUpdate = Date.now();
        fs.writeFileSync(HOLIDAY_CACHE_FILE, JSON.stringify(newCache, null, 2));
        console.log(`已更新节假日缓存：${HOLIDAY_CACHE_FILE}`);
        return { holidays, workdays };
    } catch (err) {
        console.error(`获取节假日失败：${err.message}`);
        return { holidays: new Set(), workdays: new Set() };
    }
}

async function isMarketClosed(date) {
    const year = date.year();
    const { holidays, workdays } = await getYearHolidayData(year);
    const yyyymmdd = date.format('YYYY-MM-DD');
    const isWeekend = date.day() === 0 || date.day() === 6;
    if (isWeekend) {
        return !workdays.has(yyyymmdd);
    } else {
        return holidays.has(yyyymmdd);
    }
}

// ---------- 图片下载 ----------
async function downloadImage(url, relativePath) {
    if (!url) return;
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        const stream = got.stream(url);
        const writeStream = fs.createWriteStream(fullPath);
        stream.pipe(writeStream);
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            stream.on('error', reject);
        });
        console.log(`图片下载成功：${fullPath}`);
    } catch (err) {
        console.log(`图片下载失败：${err.message}`);
    }
}

// ---------- 主函数 ----------
const command = process.env.command || '';

!(async () => {
    try {
        // 1. 解析日期
        let targetDate = moment().tz('Asia/Shanghai');
        const datePattern = /([0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]))/;
        const match = command.match(datePattern);
        if (match) {
            targetDate = moment.tz(match[0], 'YYYYMMDD', 'Asia/Shanghai');
            if (!targetDate.isValid()) {
                await sendNotify('日期格式无效，请使用 YYYYMMDD 格式');
                return;
            }
        }

        const now = moment().tz('Asia/Shanghai');
        if (targetDate.isAfter(now, 'day')) {
            await sendNotify('无法预知未来！');
            return;
        }

        // 2. 休市判断
        if (await isMarketClosed(targetDate)) {
            await sendNotify(`${targetDate.format('YYYY年MM月DD日')} 为休市日，无连板分析数据。`);
            return;
        }

        // 3. 搜索文章
        console.log(`目标日期：${targetDate.format('YYYY-MM-DD')}`);
        const articles = await searchArticles(targetDate);
        if (!articles.length) {
            await sendNotify(`未找到 ${targetDate.format('M月D日')} 连板股分析的相关文章。`);
            return;
        }

        // 4. 匹配最接近日期的文章
        const bestMatch = getBestMatchingArticle(articles, targetDate);
        if (!bestMatch) {
            await sendNotify(`未匹配到 ${targetDate.format('M月D日')} 的有效文章。`);
            return;
        }

        const article = bestMatch;
        console.log(`匹配到文章 ID：${article.id}，时间：${article.time}`);

        // 5. 准备通知内容
        const detailUrl = `https://www.cls.cn/detail/${article.id}`;
        const notifyMsg = `${article.descr}\n\n详情：${detailUrl}`;
        const imageUrl = article.img;

        // 6. 保存到自定义数据
        await addOrUpdateCustomDataTitle({
            Type: CUSTOM_DATA_TYPE,
            TypeName: '财联社连板股分析',
            Title1: '日期',
            Title2: '标题',
            Title3: '内容',
            Title4: '图片'
        });

        const dataKey = targetDate.format('M月D日连板股分析');
        const existing = await getCustomData(CUSTOM_DATA_TYPE, null, null, { Data1: dataKey });
        if (existing.length === 0) {
            await addCustomData([{
                Type: CUSTOM_DATA_TYPE,
                Data1: dataKey,
                Data2: article.descr,
                Data3: article.descr,
                Data4: imageUrl
            }]);
        }

        // 7. 发送通知
        await sendNotify([
            { msg: notifyMsg, MessageType: 1 },
            { msg: imageUrl, MessageType: 2 }
        ], true);

        // 8. 下载图片
        if (imageUrl) {
            const dirName = '财联社连板股分析图片';
            const fileName = `${targetDate.format('YYYYMMDD')}.png`;
            await downloadImage(imageUrl, path.join(dirName, fileName));
        }

    } catch (err) {
        console.error('脚本执行异常：', err);
        await sendNotify(`连板股分析脚本出错：${err.message}`);
    }
})();

