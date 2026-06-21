/**
 * 指令触发：
 * 涨停分析               // 默认当前日期
 * 涨停分析 20220701      // 指定日期
 */

const { sendNotify, addOrUpdateCustomDataTitle, addCustomData, getCustomData, updateCustomData } = require('./quantum');
const { execSync } = require('child_process');
const path = require('path');

const PY_SCRIPT = path.join(__dirname, 'quantum_cls.py');
const DATA_TYPE = 'zhangtingfenxi';

const TOPIC = process.argv[2] || '涨停分析';
const SEGMENT_SEND = false;  // true=逐条发送, false=合并发送

function log(...args) {
    console.log(`[zhangtingfenxi]`, ...args);
}

async function main() {
    const command = process.env.command || '';
    log(`command="${command}", topic="${TOPIC}"`);

    try {
        log(`spawning python: python "${PY_SCRIPT}" --topic "${TOPIC}"`);
        const stdout = execSync(
            `python "${PY_SCRIPT}" --topic "${TOPIC}"`,
            {
                env: { ...process.env, command, DEBUG: '1' },
                encoding: 'utf-8',
                timeout: 30000,
            }
        ).trim();

        log(`python stdout: ${stdout.slice(0, 200)}...`);

        const data = JSON.parse(stdout);
        log(`parsed: title=${data.title?.slice(0, 40)}..., image1=${data.image1 ? 'set' : 'empty'}, image2=${data.image2 ? 'set' : 'empty'}`);
        if (data.image1) log(`image1_url=${data.image1.slice(0, 120)}`);

        if (data.error) {
            log(`error from python: ${data.error}`);
            await sendNotify([{ msg: data.error, MessageType: 1 }], true);
            return;
        }

        // 保存自定义数据
        log(`saving custom data: date=${data.date}`);
        await addOrUpdateCustomDataTitle({
            Type: DATA_TYPE,
            TypeName: `财联社-${TOPIC}`,
            Title1: '日期',
            Title2: '标题',
            Title3: '内容',
            Title4: '图片1',
            Title5: '图片2',
        });
        log('title saved');

        // 查重 & 补全
        const record = {
            Type: DATA_TYPE,
            Data1: data.date,
            Data2: data.title,
            Data3: data.content,
            Data4: data.image1,
            Data5: data.image2,
        };

        let existing = [];
        try {
            existing = await getCustomData(DATA_TYPE, data.date) || [];
        } catch (e) {
            log(`getCustomData failed: ${e.message}, falling back to full fetch`);
            try {
                existing = (await getCustomData(DATA_TYPE) || [])
                    .filter(r => r.Data1 === data.date || r.data1 === data.date);
            } catch (e2) {
                log(`getCustomData full fetch also failed: ${e2.message}`);
            }
        }

        if (existing.length > 0) {
            const r = existing[0];
            const missing = [];
            if (!r.Data2 && !r.data2) missing.push('Data2');
            if (!r.Data3 && !r.data3) missing.push('Data3');
            if (!r.Data4 && !r.data4) missing.push('Data4');
            if (!r.Data5 && !r.data5) missing.push('Data5');

            if (missing.length > 0) {
                log(`existing record missing fields [${missing.join(', ')}], updating`);
                record.Id = r.Id || r.id;
                await updateCustomData(record);
                log('data updated');
            } else {
                log(`complete record already exists for ${data.date}, skip`);
            }
        } else {
            await addCustomData([record]);
            log('data saved');
        }

        // 发送通知
        const msgs = [{ msg: `${data.title}\n\n${data.content}`, MessageType: 1 }];
        log(`text message prepared, length=${msgs[0].msg.length}`);

        if (data.image1) {
            msgs.push({ msg: data.image1, MessageType: 2 });
            log(`image1 message added`);
        }
        if (data.image2) {
            msgs.push({ msg: data.image2, MessageType: 2 });
            log(`image2 message added`);
        }

        if (SEGMENT_SEND) {
            for (const m of msgs) {
                const r = await sendNotify([m], true);
                log(`segment sent: type=${m.MessageType}, result=${JSON.stringify(r)}`);
            }
        } else {
            log(`sending ${msgs.length} messages in batch`);
            const result = await sendNotify(msgs, true);
            log(`sendNotify result: ${JSON.stringify(result)}`);
        }

    } catch (err) {
        log(`ERROR: ${err.message}`);
        log(`stack: ${err.stack}`);
        await sendNotify([{ msg: `${TOPIC} 出错: ${err.message}`, MessageType: 1 }], true);
    }
}

main();