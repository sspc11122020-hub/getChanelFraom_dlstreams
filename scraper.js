const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://dlstreams.st'; // تم إرجاع الرابط الأصلي
const FOLDER_NAME = 'Bein sport Ar';

// دالة لفحص السيرفر إذا كان يعمل
async function validateStream(url, headers) {
    try {
        const cleanHeaders = { ...headers };
        delete cleanHeaders['host'];
        delete cleanHeaders['accept-encoding'];

        const response = await axios.get(url, { headers: cleanHeaders, timeout: 5000 });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

(async () => {
    // إنشاء المجلد الرئيسي
    await fs.mkdir(FOLDER_NAME, { recursive: true });
    
    const browser = await puppeteer.launch({ 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    let indexData = [];

    // الدوران على القنوات (من ID 91 إلى 99)
    for (let id = 91; id <= 99; id++) {
        const channelName = `beIN Sports ${id - 90} Arabic`;
        let channelData = { id, name: channelName, servers: [] };
        
        console.log(`\n📺 جارِ فحص قناة: ${channelName}`);
        
        try {
            // فتح صفحة القناة الرئيسية
            await page.goto(`${BASE_URL}/watch.php?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
            console.log(`⚠️ فشل تحميل صفحة القناة (Timeout). نتخطاها...`);
            continue;
        }

        // إحصاء عدد الأزرار المتاحة لتفادي فقدان السياق (Context)
        const buttonsCount = await page.evaluate(() => document.querySelectorAll('.player-btn').length);
        
        if (buttonsCount === 0) {
            console.log('لم يتم العثور على أزرار مشغلات.');
            continue;
        }

        // الدوران على الأزرار بناءً على العدد
        for (let i = 0; i < buttonsCount; i++) {
            console.log(`- التنصت على السيرفر رقم ${i + 1}...`);
            
            // إنشاء "وعد" (Promise) لاصطياد رابط m3u8
            const m3u8Promise = new Promise(resolve => {
                const requestHandler = request => {
                    const url = request.url();
                    if (url.includes('.m3u8')) {
                        page.off('request', requestHandler); // إيقاف التنصت
                        resolve({ url: url, headers: request.headers() });
                    }
                };
                
                page.on('request', requestHandler);
                
                // مهلة 10 ثوانٍ للسيرفر الميت
                setTimeout(() => {
                    page.off('request', requestHandler);
                    resolve(null);
                }, 10000);
            });

            // تنفيذ النقر مباشرة عبر بيئة المتصفح لحل مشكلة Context Error
            try {
                await page.evaluate((idx) => {
                    const btns = document.querySelectorAll('.player-btn');
                    if (btns[idx]) btns[idx].click();
                }, i);
            } catch (clickErr) {
                console.log(`⚠️ تعذر النقر على زر السيرفر رقم ${i + 1}.`);
            }

            // انتظار الرابط أو انتهاء المهلة
            const streamData = await m3u8Promise;

            if (streamData) {
                console.log(`  ✔️ تم اصطياد الرابط، جارِ الفحص...`);
                const isValid = await validateStream(streamData.url, streamData.headers);
                
                if (isValid) {
                    console.log(`  ✅ السيرفر يعمل! تمت الإضافة.`);
                    channelData.servers.push({
                        serverName: `Player ${i + 1}`,
                        url: streamData.url,
                        headers: streamData.headers
                    });
                } else {
                     console.log(`  ❌ السيرفر لا يعمل (404/500).`);
                }
            } else {
                console.log(`  ⚠️ لم يتم العثور على رابط m3u8 أو انتهت المهلة.`);
            }
            
            // انتظار ثانية واحدة بين السيرفرات لمنع تداخل طلبات الشبكة
            await new Promise(r => setTimeout(r, 1000));
        }

        // حفظ بيانات القناة إذا كان هناك سيرفرات تعمل
        if (channelData.servers.length > 0) {
            const fileName = `channel_${id}.json`;
            const filePath = path.join(FOLDER_NAME, fileName);
            await fs.writeFile(filePath, JSON.stringify(channelData, null, 2));
            
            indexData.push({ id, name: channelName, file: fileName });
        }
    }

    // إنشاء ملف الفهرس الشامل
    if (indexData.length > 0) {
        await fs.writeFile(path.join(FOLDER_NAME, 'channels_index.json'), JSON.stringify(indexData, null, 2));
        console.log(`\n📁 تم إنشاء ملف الفهرس: channels_index.json`);
    }
    
    await browser.close();
    console.log('\n🚀 تمت العملية بالكامل بنجاح!');
})();
