const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios'); // لفحص السيرفرات

const BASE_URL = 'https://example.com';
const FOLDER_NAME = 'Bein sport Ar';

async function validateStream(url, headers) {
    try {
        const response = await axios.get(url, { headers, timeout: 5000 });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

(async () => {
    await fs.mkdir(FOLDER_NAME, { recursive: true });
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    let indexData = [];

    // الدوران على الـ 9 قنوات (من ID 91 إلى 99 كما في الصورة)
    for (let id = 91; id <= 99; id++) {
        const channelName = `beIN Sports ${id - 90} Arabic`;
        let channelData = { id, name: channelName, servers: [] };
        
        console.log(`جارِ فحص قناة: ${channelName}`);
        await page.goto(`${BASE_URL}/watch.php?id=${id}`);

        // استخراج روابط المشغلات المتاحة للقناة
        const players = await page.$$eval('.player-btn', btns => btns.map(btn => btn.getAttribute('data-url')));

        for (const playerUrl of players) {
            const playerPage = await browser.newPage();
            await playerPage.setRequestInterception(true);
            
            let streamFound = null;

            // اعتراض طلبات الشبكة للبحث عن m3u8
            playerPage.on('request', interceptedRequest => {
                const url = interceptedRequest.url();
                if (url.includes('.m3u8') && !streamFound) {
                    streamFound = {
                        url: url,
                        headers: interceptedRequest.headers()
                    };
                }
                interceptedRequest.continue();
            });

            await playerPage.goto(`${BASE_URL}${playerUrl}`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(()=>console.log('Timeout'));
            
            if (streamFound) {
                // فحص ما إذا كان الرابط يعمل
                const isValid = await validateStream(streamFound.url, streamFound.headers);
                if (isValid) {
                    channelData.servers.push(streamFound);
                }
            }
            await playerPage.close();
        }

        // حفظ بيانات القناة في ملف JSON منفصل إذا كان هناك سيرفرات تعمل
        if (channelData.servers.length > 0) {
            const filePath = path.join(FOLDER_NAME, `channel_${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(channelData, null, 2));
            indexData.push({ id, name: channelName, file: `channel_${id}.json` });
        }
    }

    // إنشاء ملف الفهرس (Index)
    await fs.writeFile(path.join(FOLDER_NAME, 'index.json'), JSON.stringify(indexData, null, 2));
    
    await browser.close();
    console.log('تمت العملية بنجاح!');
})();
