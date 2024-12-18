import { describe, it } from "@jest/globals";
import { Memory, APIType } from "../src/memory/base";

declare global {
  var logger: any;
}

globalThis.logger = console;
const config = {
  llm: {
    APIType: APIType.CustomURL,
    BaseURL: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    UID: "",
    APIKey: "27cde01cfd7936876db4f94b66a71b78.Rtr9czc2vZsvtehU",
    AIModel: "glm-4-flash",
  },
  embedder: {
    APIType: APIType.Ollama,
    BaseURL: "http://127.0.0.1:11434",
    UID: "",
    APIKey: "",
    AIModel: "nomic-embed-text:latest",
  },
};

const parameters = {
  Temperature: 0,
  OtherParameters: [],
}
describe("Memory", () => {

  it("Memory", async () => {
    const m = new Memory(config, parameters);
    let result;

    // 1. Add: Store a memory from any unstructured text
    result = await m.add("自然本身给动物规定了它应该遵循的活动范围，动物也就安分地在这个范围内活动，不试图越出这个范围，甚至不考虑有其他什么范围的存在。神也给人指定了共同的目标──使人类和他自己趋于高尚，但是，神要人自己去寻找可以达到这个目标的手段；神让人在社会上选择一个最适合于他、最能使他和社会都得到提高的地位。", "alice", { category: "hobbies" });

    // Created memory --> 'Improving her tennis skills.' and 'Looking for online suggestions.'

    // 2. Update: update the memory
    //result = m.update(memory_id=<memory_id_1>, data="Likes to play tennis on weekends")

    // Updated memory --> 'Likes to play tennis on weekends.' and 'Looking for online suggestions.'

    // 3. Search: search related memories
    //related_memories = m.search(query="What are Alice's hobbies?", user_id="alice")

    // Retrieved memory --> 'Likes to play tennis on weekends'

    // 4. Get all memories
    // all_memories = m.get_all()
    // memory_id = all_memories["memories"][0] ["id"] // get a memory_id

    // All memory items --> 'Likes to play tennis on weekends.' and 'Looking for online suggestions.'

    // 5. Get memory history for a particular memory_id
    // history = m.history(memory_id=<memory_id_1>)

    // Logs corresponding to memory_id_1 --> {'prev_value': 'Working on improving tennis skills and interested in online courses for tennis.', 'new_value': 'Likes to play tennis on weekends' }
  });
});
