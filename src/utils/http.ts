import axios from "axios";
import JSON5 from "json5";

import { foldText } from "./string";

export async function sendRequest(url: string, APIKey: string, requestBody: any, debug: boolean = false): Promise<any> {
    if (debug) {
      logger.info(`Request URL: ${url}`);
      logger.info(`Request body: \n${foldText(JSON5.stringify(requestBody, null, 2), 2100)}`);
    }

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': `Bearer ${APIKey}`,
          'Content-Type': "application/json",
        },
      });

      if (response.status !== 200) {
        const errorMessage = JSON5.stringify(response.data);
        throw new Error(`请求失败: ${response.status} - ${errorMessage}`);
      }

      const result = await response.data;
      return result;
    } catch (error) {
      if (error.response) {
        throw new Error(`请求失败: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
