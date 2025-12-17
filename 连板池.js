/**
 * 指令触发：
 * 连板池 //默认当前日期
 * 连板池 20220701 //指定日期
 * */

const got = require('got');
const {
    sendNotify
} = require('./quantum');

const moment = require('moment');

const api = got.extend({
    retry: { limit: 0 },
});

//触发指令
var command = process.env.command;

!(async () => {
    var pattern = /[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/
    var date = "";
    if (pattern.test(command)) {
        date = command.match(/[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/)[0]
    } else {
        let d = new Date()
        var m = (d.getMonth() + 1);
        var day = d.getDate();
        date = d.getFullYear().toString() + (m > 9 ? m.toString() : "0" + m) + (day > 9 ? day.toString() : "0" + day)
    }
    console.log(date)
    if (moment(date, 'YYYYMMDD') > moment()) {
        await sendNotify("无法预知未来！");
        return;
    }
    var week = moment(date, 'YYYYMMDD').weekday();
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

    /**
    * 涨幅	change_rate	199112
    当前价格	latest	10
    涨停原因	reason_type	9001
    开板次数	open_num	9002
    近一年涨停封板率	limit_up_suc_rate	9003
    分时预览（无用参数）	time_preview	9004
    首次涨停时间	first_limit_up_time	330323
    最后涨停时间	last_limit_up_time	330324
    涨停形态	limit_up_type	330325
    几天几板	high_days	330329
    分单量/万元	order_volume	133971
    ID	market_id	133970
    换手率	turnover_rate	1968584
    流通市值	currency_value	3475914
     */

    var config = {
        method: 'get',
        //url: 'https://data.10jqka.com.cn/dataapi/limit_up/continuous_limit_up?filter=HS,GEM2STAR&date=' + date //连板天梯
        url: 'https://data.10jqka.com.cn/dataapi/limit_up/continuous_limit_pool?page=1&limit=300&field=199112,10,330329,330325,133971,133970,1968584,3475914,3541450,9001&filter=HS,GEM2STAR&order_field=330329&order_type=0&date=' + date
    };

    await api(config).then(async response => {

        console.log(response.body)
        var body = JSON.parse(response.body)

        if (body.status_code == 0) {
            if (body.data.info && body.data.info.length > 0) {

                var message_number = "";
                message_number = `连板票池： \n当前日期：${date}  连板数量：${body.data.page.total}`

                var message = "";
                for (var i = 0; i < body.data.info.length; i++) {
                    message += `${body.data.info[i].code} ${body.data.info[i].name} ${body.data.info[i].high_days} ${body.data.info[i].limit_up_type} ${body.data.info[i].reason_type}
 `
                    message = message.trim("，") + "\r";
                }
                await sendNotify(message_number + "\n" + message);
                //await sendNotify(message);
            } else {
                await sendNotify("接口未返回数据。")
            }
        } else {
            console.log(response.body);
        }
        //    var message = body.data.zh + "\n" + body.data.en;
        //    await sendNotify(message)
    });
})();

/**
 * 代码 	名称	几天几版	涨停形态	涨停原因
code	name	high_days	limit_up_type	reason_type
 */



