import https from 'https';

import axios from "axios";
import sharp from "sharp";


// 从URL获取图片的base64编码
export async function convertUrltoBase64(url: string): Promise<string> {
    url = url.replace(/&amp;/g, '&');
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 忽略SSL证书验证
        timeout: 5000  // 5秒超时
      });
  
      let buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';
  
      // 如果图片大小大于10MB，压缩图片到10MB以内
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (buffer.length > maxSize) {
        do {
          buffer = await sharp(buffer)
            .jpeg({ quality: Math.max(10, Math.floor((maxSize / buffer.length) * 80)) }) // 动态调整质量
            .toBuffer();
        } while (buffer.length > maxSize);
      }
  
      const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
      return base64;
    } catch (error) {
      console.error('Error converting image to base64:', error.message);
      return "";
    }
  }