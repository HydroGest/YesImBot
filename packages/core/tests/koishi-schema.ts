import { Schema } from "koishi";
import { schemaToJSONSchema } from "../src/shared/utils/schema";

export const testSchema = Schema.object({
    test: Schema.string().required().description("测试参数"),
    test2: Schema.string().default("test2").description("测试参数2"),
    obj: Schema.object({
        a: Schema.string().description("对象参数a"),
        b: Schema.number().required().description("对象参数b"),
    }).description("这是一个嵌套对象"),
    enum: Schema.union([Schema.const("a").description("选项A"), Schema.const("b").description("选项B")]).description(
        "这是一个枚举",
    ),
    arr: Schema.array(Schema.number().description("数组元素")).description("这是一个数组"),
    require: Schema.string().required().description("这是一个必填参数"),
});

const jsonSchema = schemaToJSONSchema(testSchema);
console.log(JSON.stringify(jsonSchema, null, 2));
