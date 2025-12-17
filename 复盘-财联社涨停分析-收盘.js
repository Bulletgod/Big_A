/**
 * 指令触发：
 * 财联社涨停分析
 * 涨停分析 //默认当前日期
 * 涨停分析 20220701 //指定日期
 * */

let fs = require('fs')
let request = require('request')
let path = require('path')
const got = require('got');
const {
    sendNotify, addOrUpdateCustomDataTitle, addCustomData, getCustomData, updateCustomData
} = require('./quantum');

const moment = require('moment');

const api = got.extend({
    retry: { limit: 0 },
});

//触发指令
var command = process.env.command || "";

!(async () => {

    var customerDataType = "zhangtingfenxi"
    var pattern = /[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/

    var date = moment();

    if (pattern.test(command)) {
        var dateStr = command.match(/[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/)[0]
        date = moment(dateStr);
    }
    var date1 = date.format("M月D日涨停分析");
    console.log(date1)
    if (date > moment()) {
        await sendNotify("无法预知未来！");
        return;
    }
    var week = date.weekday();
    console.log(week);
    if (week == 6) {
        await sendNotify("周六休市！")
        return;
    }
    if (week == 0) {
        await sendNotify("周日休市！")
        return;
    }
    // console.log();


    //现在写死的这一天  因为这个sign就是11月15日这个连接的 想要的效果是还和以前一样 输入的触发指令是那种格式   走完判断周末周六后，再格式化成  （date1 = "11月15日连板股分析" ）这样的格式传给 第一个链接拿到当天的ID  传给第二个链接，接下来就是解决财联社sign的问题

    var config = {
        method: "get",
        //url: 'https://data.10jqka.com.cn/dataapi/limit_up/continuous_limit_up?filter=HS,GEM2STAR&date=' + date //连板天梯
        url:
            "https://appsearch.cls.cn/api/search/get_all_list?app=cailianpress&sv=7.8.9&cuid=Unkown&os=android&ov=30&channel=6&type=telegram&province_code=6101&token=&uid=&mb=Xiaomi-M2102K1C&page=0&motif=0&rn=20&keyword=" +
            date1,
    };

    await addOrUpdateCustomDataTitle({
        Type: customerDataType,
        TypeName: "财联社涨停分析",
        Title1: "日期",
        Title2: "标题",
        Title3: "内容",
        Title4: "图片"
    });

    await api(config).then(async (response) => {
        console.log(response.body);
        var body = JSON.parse(response.body);
        var id = body.data.telegram.data[0].id;
        console.log(id)
        //if (https) {
        //    await sendNotify(https)
        //} else {
        //    await sendNotify("接口未返回数据。")
        //}
        var config_img = {
            method: "get",
            url:
                "https://api3.cls.cn/share/article/" + id + "?os=android&sv=9.8.9&app=cailianpress",
        };
        await api(config_img).then(async (response) => {


            var header = response.body.match(/telegraph-title-box">([^<]+)(?=<?)/)[1].substring(8)
            var content = response.body.match(/telegraph-content content">([^<]+)(?=<?)/)[1].trim()
            //var header = response.body.match(/<span class="title"><span class="([^<]+)(?=<?)/)[1].substring(21)
            //var content = response.body.match(/telegraph-content">([^<]+)(?=<?)/)[1]
            var image = response.body.match(/<img class="w-100p h-100p o-f-c multigraph-image lazyload" data-src="([^"]+)(?="?)/)[1]

            var content = content
                .replace(/^[\s\uFEFF\xA0]+/g, '')   // 移除所有制表符
                .replace(/\t/g, ' ');             // 可选：将制表符转为普通空格



            var sss = await getCustomData(customerDataType, null, null, {
                Data1: date1
            });
            if (sss.length == 0) {
                await addCustomData([{
                    Type: customerDataType,
                    Data1: date1,
                    Data2: header,
                    Data3: content,
                    Data4: image
                }]);
            }
            console.log(`header：${header}， content：${content}`);
            await sendNotify([{
                msg: `${header}
 ${content}`, MessageType: 1
            }, {
                msg: image,
                MessageType: 2
            }], true)

            var dirName = "财联社涨停分析图片"
            //fs.mkdirSync(path.join(__dirname, dirName))
            downloadImage(image, dirName + '/' + date1 + ".png");
        });
    });
})().catch((e) => {
    console.log("脚本执行异常：" + e);
});


async function downloadImage(url, name) {
    got({
        method: 'get',
        url: url,
        responseType: 'stream'
    })
        .then(async function (response) {
            response.body.pipe(fs.createWriteStream(name))
        });
}

function downloadImage(url, name) {
    const download = (src, dest, callback) => {
        request.head(src, (err, res, body) => {
            if (err) { console.log(err); return }
            src && request(src).pipe(fs.createWriteStream(path.join(__dirname, dest))).on('close', () => {
                callback && callback(null, path.join(__dirname, dest))
            })
        })
    }
    download(url, name, (err, data) => {
        err ? console.log(err) : console.log(`下载成功！图片地址是：${path.resolve(data)}`)
    })
}
