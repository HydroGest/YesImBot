import fs from 'fs';
import https from 'https';
import { promisify } from 'util';

export function getFileNameFromUrl(url: string): string {  
    const parsedUrl = new URL(url);  
    const filePath = parsedUrl.pathname;  
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);  
    return fileName;  
}  


// 将 fs.exists 转换为 Promise 版本
const exists = promisify(fs.exists);

export async function ensurePromptFileExists(url: string): Promise<void> {
    const filePath = getFileNameFromUrl(url);

    const fileExists = await exists(filePath);
    if (fileExists) {
        console.log('文件已存在。');
        return;
    }

    // 文件不存在，从 URL 下载
    console.log('文件不存在，开始下载...');
    const file = fs.createWriteStream(filePath);
    const request = https.get(url, response => {
        response.pipe(file);

        file.on('finish', () => {
            file.close();
            console.log('文件下载完成。');
        });
    });

    request.on('error', err => {
        fs.unlink(filePath, () => {}); 
        console.error('下载文件时出错:', err.message);
    });
}


export async function genSysPrompt(config: any, curGroupDescription: string, curGroupName: string): Promise<string> {
	// 获取当前日期
	const currentDate = new Date();  
	const curYear: number = currentDate.getFullYear();  
	const curMonth: number = currentDate.getMonth() + 1;  
	const curDate: number = currentDate.getDate();  

	let content = fs.readFileSync(getFileNameFromUrl(config.Bot.PromptFileUrl[config.Bot.PromptFileSelected]), 'utf-8');  
	
	content = content.replaceAll("${config.Bot.BotName}", config.Bot.BotName);
	content = content.replaceAll("${config.Bot.WhoAmI}", config.Bot.WhoAmI);
	content = content.replaceAll("${config.Bot.BotHometown}", config.Bot.BotHometown);
	content = content.replaceAll("${config.Bot.BotYearold}", config.Bot.BotYearold);
	content = content.replaceAll("${config.Bot.BotPersonality}", config.Bot.BotPersonality);
	content = content.replaceAll("${config.Bot.BotGender}", config.Bot.BotGender);
	content = content.replaceAll("${config.Bot.BotHabbits}", config.Bot.BotHabbits);
	content = content.replaceAll("${config.Bot.BotBackground}", config.Bot.BotBackground);
	content = content.replaceAll("${config.Bot.CuteMode}", config.Bot.CuteMode);
	
	content = content.replaceAll("${curYear}", curYear.toString());
	content = content.replaceAll("${curMonth}", curMonth.toString());
	content = content.replaceAll("${curDate}", curDate.toString());
	
	content = content.replaceAll("${curGroupDescription}", curGroupDescription);
	content = content.replaceAll("${curGroupName}", curGroupName);

	return content;
}