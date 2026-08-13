import type { Argv, Command, Context } from "koishi";
import type { Config } from "@/config";
import { Service } from "koishi";
import { Services } from "@/shared/constants";
import { isEmpty, parseKeyChain, tryParse } from "@/shared/utils";

declare module "koishi" {
    interface Services {
        [Services.Command]: CommandService;
    }
}

export class CommandService extends Service {
    private command: Command;
    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Command, true);
        this.command = ctx.command("yesimbot", "Yes! I'm Bot! 指令集", { authority: 3 });

        this.subcommand(".conf", "配置管理指令集", { authority: 3 });

        this.subcommand(".conf.get [key:string]", { authority: 3 }).action(async ({ session, options }, key) => {
            if (isEmpty(key))
                return "请输入有效的配置键";
            let parsedKeyChain: (string | number)[];
            try {
                parsedKeyChain = parseKeyChain(key);
            } catch (e) {
                return (e as Error).message;
            }

            const data = get(config, parsedKeyChain);

            return JSON.stringify(data, null, 2) || "未找到配置";

            function get(data: any, keys: (string | number)[]) {
                if (keys.length === 0)
                    return data;

                // 递归情况：处理键链
                const currentKey = keys[0]; // 当前处理的键或索引
                const restKeys = keys.slice(1); // 剩余的键链
                const nextKeyIsIndex = typeof restKeys[0] === "number"; // 检查下一个键是否为数字索引

                return get(data[currentKey], restKeys);
            }
        });

        this.subcommand(".conf.set [key:string] [value:string]", { authority: 3 })
            .option("force", "-f <force:boolean>")
            .action(async ({ session, options }, key, value) => {
                if (isEmpty(key))
                    return "请输入有效的配置键";
                if (isEmpty(value))
                    return "请输入有效的值";

                // 新增：解析键链，支持数组索引
                let parsedKeyChain: (string | number)[];
                try {
                    parsedKeyChain = parseKeyChain(key);
                } catch (e) {
                    return (e as Error).message;
                }

                try {
                    // 确保 top-level config 是一个对象，以便可以添加属性
                    // 如果 config 是 null 或 primitive，需要将其初始化为对象
                    let mutableConfig: any = config;
                    if (typeof mutableConfig !== "object" || mutableConfig === null) {
                        mutableConfig = {};
                    }

                    // 调用更新后的 set 函数
                    const data = set(mutableConfig, parsedKeyChain, value);
                    ctx.scope.parent.scope.update(data, Boolean(options.force));
                    config = data; // 更新全局 config 变量
                    return "设置成功";
                } catch (e) {
                    // 恢复原来的配置
                    ctx.scope.update(config, Boolean(options.force)); // 确保作用域恢复到原始配置
                    ctx.logger.error(e);
                    return (e as Error).message;
                }

                /**
                 * 递归地设置配置项，支持深层嵌套的对象和数组。
                 * 使用不可变更新模式，返回新的配置对象。
                 *
                 * @param currentData 当前层级的配置对象或数组。
                 * @param keyChain 剩余的键路径。
                 * @param value 要设置的原始字符串值。
                 * @returns 更新后的新配置对象或值。
                 */
                function set(currentData: any, keyChain: Array<string | number>, value: any): any {
                    // 基本情况：键路径已为空，表示已到达目标位置，直接设置值
                    if (keyChain.length === 0) {
                        return tryParse(value); // 使用 tryParse 智能转换最终值
                    }
                    const currentKey = keyChain.shift()!; // 取出当前层级的键或索引
                    // 判断下一个键是数组索引还是对象键，以便决定如何初始化
                    const nextKeyIsIndex = typeof keyChain[0] === "number";
                    // 如果当前层级的数据是 null 或 undefined，或者类型不匹配，就初始化它
                    let nextSegment = currentData ? currentData[currentKey] : undefined;
                    if (nextSegment === undefined || nextSegment === null) {
                        // 如果下一个键是数字，初始化为数组；否则初始化为对象。
                        nextSegment = nextKeyIsIndex ? [] : {};
                    } else if (nextKeyIsIndex && !Array.isArray(nextSegment)) {
                        // 类型不匹配：期望数组，但现有不是数组，强制转换为数组
                        console.warn(`Path segment "${currentKey}" was not an array, converting to array.`);
                        nextSegment = [];
                    } else if (!nextKeyIsIndex && (typeof nextSegment !== "object" || Array.isArray(nextSegment))) {
                        // 类型不匹配：期望对象，但现有不是对象或却是数组，强制转换为对象
                        console.warn(`Path segment "${currentKey}" was not an object, converting to object.`);
                        nextSegment = {};
                    }
                    // 如果当前键是数字（数组索引），且当前数据是数组
                    if (typeof currentKey === "number" && Array.isArray(currentData)) {
                        // 确保数组有足够的长度来容纳指定索引。不足的部分填充 null。
                        // 这确保了像 `arr[5]` 这种直接索引的设置也能正常工作。
                        while (currentData.length <= currentKey) {
                            currentData.push(null); // 或者 undefined
                        }
                        // 创建数组的拷贝以实现不可变更新
                        const newArray = [...currentData];
                        newArray[currentKey] = set(nextSegment, keyChain, value);
                        return newArray;
                    } else {
                        // 如果当前键是字符串（对象键），且当前数据是对象
                        // 创建对象的拷贝以实现不可变更新
                        const newObject = { ...currentData };
                        newObject[currentKey] = set(nextSegment, keyChain, value);
                        return newObject;
                    }
                }
            });
    }

    subcommand<D extends string>(def: D, config?: Command.Config): Command<never, never, Argv.ArgumentType<D>>;
    subcommand<D extends string>(def: D, desc: string, config?: Command.Config): Command<never, never, Argv.ArgumentType<D>>;
    public subcommand<D extends string>(def: D, desc?: string | Command.Config, config?: Command.Config) {
        if (typeof desc === "string") {
            return this.command.subcommand(def, desc, config);
        } else {
            return this.command.subcommand(def, desc);
        }
    }
}
