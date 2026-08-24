const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://dlstreams.st/24-7-channels.php'; // تم استبدال النطاق للحماية
const FOLDER_NAME = 'Bein sport Ar';

// دالة لفحص السيرفر إذا كان يعمل
async function validateStream(url, headers) {
    try {
        // تنظيف بعض الترويسات التي قد تمنع axios من العمل خارج المتصفح
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
    
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    let indexData = [];

    // الدوران على القنوات (من ID 91 إلى 99)
    for (let id = 91; id <= 99; id++) {
        const channelName = `beIN Sports ${id - 90} Arabic`;
        let channelData = { id, name: channelName, servers: [] };
        
        console.log(`\n📺 جارِ فحص قناة: ${channelName}`);
        
        // فتح صفحة القناة الرئيسية
        await page.goto(`${BASE_URL}/watch.php?id=${id}`, { waitUntil: 'domcontentloaded' });

        // جلب جميع أزرار المشغلات في الصفحة بناءً على الكلاس الموجود في الكود الخاص بك
        const buttons = await page.$$('.player-btn');
        
        if (buttons.length === 0) {
            console.log('لم يتم العثور على أزرار مشغلات.');
            continue;
        }

        // الدوران على الأزرار والنقر عليها واحداً تلو الآخر
        for (let i = 0; i < buttons.length; i++) {
            console.log(`- التنصت على السيرفر رقم ${i + 1}...`);
            
            // إنشاء "وعد" (Promise) لاصطياد رابط m3u8 من تبويب Network
            const m3u8Promise = new Promise(resolve => {
                const requestHandler = request => {
                    const url = request.url();
                    // بمجرد أن تلمح الشبكة طلب يحتوي على m3u8
                    if (url.includes('.m3u8')) {
                        page.off('request', requestHandler); // إيقاف التنصت لهذا السيرفر
                        resolve({ url: url, headers: request.headers() });
                    }
                };
                
                // بدء التنصت على الشبكة
                page.on('request', requestHandler);
                
                // وضع مهلة 10 ثوانٍ (إذا كان السيرفر ميت ولن يرسل m3u8) لكي لا يتجمد السكربت
                setTimeout(() => {
                    page.off('request', requestHandler);
                    resolve(null);
                }, 10000);
            });

            // النقر على زر المشغل لتشغيل السيرفر
            await buttons[i].click();

            // انتظار اصطياد الرابط من الشبكة
            const streamData = await m3u8Promise;

            if (streamData) {
                console.log(`  ✔️ تم اصطياد الرابط، جارِ الفحص...`);
                // فحص ما إذا كان الرابط يعمل فعلياً
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
        }

        // حفظ بيانات القناة في ملف json منفصل داخل المجلد إذا كان هناك سيرفرات تعمل
        if (channelData.servers.length > 0) {
            const fileName = `channel_${id}.json`;
            const filePath = path.join(FOLDER_NAME, fileName);
            await fs.writeFile(filePath, JSON.stringify(channelData, null, 2));
            
            // إضافة القناة للملف التعريفي
            indexData.push({ id, name: channelName, file: fileName });
        }
    }

    // إنشاء ملف يجمع أسماء القنوات ويربطها بملفاتها (الفهرس)
    if (indexData.length > 0) {
        await fs.writeFile(path.join(FOLDER_NAME, 'channels_index.json'), JSON.stringify(indexData, null, 2));
        console.log(`\n📁 تم إنشاء ملف الفهرس: channels_index.json`);
    }
    
    await browser.close();
    console.log('\n🚀 تمت العملية بالكامل بنجاح!');
})();
