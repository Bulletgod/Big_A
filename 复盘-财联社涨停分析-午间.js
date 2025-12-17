/**
 * 指令触发：
 * 财联社午间涨停分析
 * 午间分析 //默认当前日期
 * 午间分析 20220701 //指定日期
 * */

let fs = require('fs')
let path = require('path')
const got = require('got');
const {
    sendNotify, addOrUpdateCustomDataTitle, addCustomData, getCustomData
} = require('./quantum');

const moment = require('moment');

const api = got.extend({
    retry: { limit: 0 },
});

//触发指令
var command = process.env.command || "";

!(async () => {
    var customerDataType = "wujianzhangtingfenxi"
    var pattern = /[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/

    var date = moment();

    if (pattern.test(command)) {
        var dateStr = command.match(/[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/)[0]
        date = moment(dateStr, "YYYYMMDD");
    }
    
    var date1 = date.format("M月D日午间涨停分析");
    console.log("查询日期:", date1)
    
    if (date > moment()) {
        await sendNotify("无法预知未来！");
        return;
    }
    
    var week = date.weekday();
    console.log("星期:", week);
    if (week === 6) {
        await sendNotify("周六休市！")
        return;
    }
    if (week === 0) {
        await sendNotify("周日休市！")
        return;
    }

    // 检查是否已存在数据
    var existingData = await getCustomData(customerDataType, null, null, {
        Data1: date1
    });
    
    if (existingData.length > 0) {
        console.log("数据已存在，直接返回");
        const data = existingData[0];
        // 构建消息数组
        const notifyMessages = [
            {
                msg: `${data.Data2}\n${data.Data3}`,
                MessageType: 1
            }
        ];
        
        // 添加图片消息
        if (data.Data4) {
            notifyMessages.push({
                msg: data.Data4,
                MessageType: 2
            });
        }
        if (data.Data5) {
            notifyMessages.push({
                msg: data.Data5,
                MessageType: 2
            });
        }
        
        await sendNotify(notifyMessages, true);
        return;
    }

    try {
        // 搜索文章
        var searchConfig = {
            method: "get",
            url: "https://appsearch.cls.cn/api/search/get_all_list?app=cailianpress&sv=7.8.9&type=telegram&page=0&rn=20&keyword=" + encodeURIComponent(date1),
        };

        const searchResponse = await api(searchConfig);
        console.log("搜索响应状态:", searchResponse.statusCode);
        
        var searchBody = JSON.parse(searchResponse.body);
        
        if (!searchBody.data || !searchBody.data.telegram || !searchBody.data.telegram.data || searchBody.data.telegram.data.length === 0) {
            await sendNotify("未找到" + date1 + "的数据");
            return;
        }

        var article = searchBody.data.telegram.data[0];
        var id = article.id;
        console.log("文章ID:", id);

        // 获取文章详情
        var articleConfig = {
            method: "get",
            url: "https://api3.cls.cn/share/article/" + id + "?os=android&sv=9.8.9&app=cailianpress",
        };

        const articleResponse = await api(articleConfig);
        console.log("文章响应状态:", articleResponse.statusCode);
        
        var articleHtml = articleResponse.body;

        // 使用更精确的正则表达式匹配
        // 提取标题 - 匹配【11月13日午间涨停分析】部分
        var titleMatch = articleHtml.match(/telegraph-title-box">[^<]*【([^】]+)】<\/section>/);
        if (!titleMatch) {
            // 备用匹配方案
            titleMatch = articleHtml.match(/telegraph-title-box">([^<]+)<\/section>/);
        }
        
        // 提取内容
        var contentMatch = articleHtml.match(/telegraph-content content">\s*([^<]+)\s*<\/div>/);
        if (!contentMatch) {
            // 备用匹配方案
            contentMatch = articleHtml.match(/<div class="c-e10000 telegraph-content content">\s*([^<]+)\s*<\/div>/);
        }
        
        // 提取所有图片
        var imageMatches = [];
        var imageRegex = /<img class="[^"]*multigraph-image[^"]*"[^>]*data-src="([^"]+)"/g;
        var match;
        while ((match = imageRegex.exec(articleHtml)) !== null) {
            imageMatches.push(match[1]);
        }

        if (!titleMatch || !contentMatch) {
            await sendNotify("解析文章内容失败，请检查网页结构是否变化");
            return;
        }

        var header = titleMatch[1] ? `【${titleMatch[1]}】` : titleMatch[1].replace(/^\d{2}:\d{2}:\d{2}/, '').trim();
        var content = contentMatch[1].trim();

        console.log(`标题：${header}`);
        console.log(`内容：${content}`);
        console.log(`找到 ${imageMatches.length} 张图片`);

        // 构建消息数组
        const notifyMessages = [
            {
                msg: `${header}\n${content}`,
                MessageType: 1
            }
        ];

        // 添加图片消息
        if (imageMatches.length > 0) {
            notifyMessages.push({
                msg: imageMatches[0],
                MessageType: 2
            });
        }
        if (imageMatches.length > 1) {
            notifyMessages.push({
                msg: imageMatches[1],
                MessageType: 2
            });
        }

        // 更新数据库结构，增加图片2字段
        await addOrUpdateCustomDataTitle({
            Type: customerDataType,
            TypeName: "财联社午间涨停分析",
            Title1: "日期",
            Title2: "标题",
            Title3: "内容",
            Title4: "图片1",
            Title5: "图片2"
        });

        // 保存到数据库（保存两张图片）
        await addCustomData([{
            Type: customerDataType,
            Data1: date1,
            Data2: header,
            Data3: content,
            Data4: imageMatches[0] || '',
            Data5: imageMatches[1] || ''
        }]);

        // 发送通知
        await sendNotify(notifyMessages, true);

        // 下载图片
        if (imageMatches.length > 0) {
            const dirName = "财联社午间涨停分析图片";
            for (let i = 0; i < Math.min(imageMatches.length, 2); i++) {
                const imageName = i === 0 ? "大涨股" : "市场焦点股票";
                await downloadImage(imageMatches[i], `${dirName}/${date.format("YYYYMMDD")}_${imageName}.png`);
            }
        }

    } catch (error) {
        console.error("脚本执行异常:", error);
        await sendNotify("获取数据失败: " + error.message);
    }
})().catch((e) => {
    console.log("脚本执行异常：" + e);
});

// 使用got下载图片的函数
async function downloadImage(url, filePath) {
    try {
        // 确保目录存在
        const dir = path.dirname(path.join(__dirname, filePath));
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const fullPath = path.join(__dirname, filePath);
        
        const response = await got(url, {
            responseType: 'buffer',
            timeout: 30000
        });

        fs.writeFileSync(fullPath, response.body);
        console.log(`图片下载成功: ${fullPath}`);
    } catch (error) {
        console.error('下载图片失败:', error);
    }
}
