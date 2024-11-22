import axios from "axios";
import JSON5 from "json5";

export async function sendRequest(url: string, APIKey: string, requestBody: any,  debug: boolean): Promise<any> {
  if (debug) {
    console.log(`Request body: \n${JSON5.stringify(requestBody, null, 2)}`);
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${APIKey}`,
        'Content-Type': "application/json",
      },
    });

    if (response.status !== 200) {
      const errorMessage = response.data;
      throw new Error(`请求失败: ${response.status} - ${errorMessage}`);
    }

    const result = await response.data;
    return result;
  } catch (error) {
    throw error;
  }
}
